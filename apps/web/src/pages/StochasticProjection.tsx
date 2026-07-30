import {
  ageAtYear,
  DEFAULT_ASSET_ALLOCATION,
  getLatestConfirmedRuleSet,
  isStochasticEligible,
  listHistoricalReturns,
  listHistoricalReturnsSources,
  listUsEquityReturns,
  listUsEquityReturnsSources,
  MONTE_CARLO_DEFAULT_PRESETS,
  penceToPounds,
  RISK_PROFILE_PRESETS,
  zeroPence,
  type Account,
  type AssetAllocation,
  type AssetClass,
  type FinalOutcome,
  type Owner,
  type Person,
  type StochasticBatchResult,
  type StochasticMethod,
} from "@fp/engine";
import { Accordion, Card, Alert, Anchor, Button, Group, NumberInput, Progress, Select, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { AboutDialog } from "../components/AboutDialog.js";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { OpenFromFileButton } from "../components/OpenFromFileButton.js";
import { PlanShareControls } from "../components/PlanShareControls.js";
import { formatMoneyRounded, formatPercent } from "../format.js";
import { computeNetWorth, computeProjection, projectionYearsFor } from "../projection.js";
import { useScenarioStore } from "../state/store.js";
import type { StochasticWorkerMessage, StochasticWorkerRequest } from "../workers/stochasticProjection.worker.js";

const RUN_COUNT_OPTIONS = ["200", "500", "1000", "2000"];
const CHART_COLOR = "#1c7ed6";
const DETERMINISTIC_COLOR = "#f08c00";
const SUCCESS_COLOR = "#2f9e44";
/** A shortfall year where net worth was still positive overall — money existed but wasn't accessible (e.g. still locked in a pension before minimum access age), distinct from genuinely running out (`SHORTFALL_COLOR`). */
const RECOVERABLE_COLOR = "#f2b705";
const SHORTFALL_COLOR = "#e03131";
const HISTOGRAM_BUCKET_COUNT = 16;
const PERCENTILE_HISTOGRAM_BUCKET_COUNT = 10;

interface ChartRow {
  readonly year: string;
  readonly deterministic: number;
  readonly p10: number;
  readonly p15: number;
  readonly p25: number;
  readonly p50: number;
  readonly p75: number;
  readonly p85: number;
  readonly p90: number;
}

/**
 * A custom tooltip, not the default Recharts one — the default reads
 * every series' raw `dataKey`/value straight off the chart, which for a
 * stacked-band chart means the two invisible base `Area`s (`p10`/`p25`,
 * needed to *position* the bands) and the bands' own *widths* (not their
 * actual upper values) all show up as confusing, half-meaningless rows.
 * This reads the underlying `ChartRow` directly instead and prints
 * exactly the six numbers that matter, each once, correctly labelled.
 */
function ConfidenceTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const row = payload[0]?.payload as ChartRow | undefined;
  if (!row) return null;
  return (
    <Card withBorder padding="xs" shadow="md">
      <Stack gap={2}>
        <Text size="sm" fw={700}>
          {label}
        </Text>
        <Text size="xs" c="orange">
          Deterministic: {formatMoneyRounded(row.deterministic)}
        </Text>
        <Text size="xs">90th percentile: {formatMoneyRounded(row.p90)}</Text>
        <Text size="xs">85th percentile: {formatMoneyRounded(row.p85)}</Text>
        <Text size="xs">75th percentile: {formatMoneyRounded(row.p75)}</Text>
        <Text size="xs" fw={700} c="blue">
          Median: {formatMoneyRounded(row.p50)}
        </Text>
        <Text size="xs">25th percentile: {formatMoneyRounded(row.p25)}</Text>
        <Text size="xs">15th percentile: {formatMoneyRounded(row.p15)}</Text>
        <Text size="xs">10th percentile: {formatMoneyRounded(row.p10)}</Text>
      </Stack>
    </Card>
  );
}

interface HistogramBucket {
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly label: string;
  readonly successPct: number;
  readonly recoverablePct: number;
  readonly shortfallPct: number;
  readonly successCount: number;
  readonly recoverableCount: number;
  readonly shortfallCount: number;
  /** The pooled "top 10%" bucket spans a much wider £ range than the regular bins — flagged so the chart can style it as visually distinct rather than let it masquerade as just another same-width bin (which reads as a false second cluster at the tail). */
  readonly isOverflow?: boolean;
  /** An empty, non-interactive bin inserted purely to put a visual gap before the overflow bucket. */
  readonly isSpacer?: boolean;
  /** The overflow bucket's true single highest outcome — kept separate from `rangeHigh` (which is capped at the 99th percentile) since the batch's literal maximum is a statistically unstable number that simply grows with "Number of runs," and isn't fit to headline as if it were a real, reproducible boundary. */
  readonly trueMax?: number;
}

/**
 * The fan chart's p10-p90 band collapses a whole distribution down to five
 * numbers, which can make a wide band (e.g. "£0 to £7m") look like it's
 * split evenly across that range when it might actually be a pile of
 * failed runs near zero plus a long thin tail of very good ones, or a
 * smooth spread — those look identical as a band but very different as a
 * histogram. Bucketing linearly across the *full* min-max range doesn't
 * work here though: 100%-equities compounding over 40+ years occasionally
 * produces one run tens of millions above the rest (a real feature of
 * historical returns, not a bug — see SPEC.md's stochastic-projections
 * section), and a single such outlier stretches a linear axis so far that
 * every other bucket collapses into one indistinguishable spike. Bucketing
 * is instead capped at the 90th percentile — already a familiar cut point
 * from the fan chart above — with everything beyond it pooled into one
 * "+" overflow bucket, so the resolution goes to the bulk of the
 * distribution instead of being wasted on its rare, extreme tail.
 */
function buildHistogram(finalOutcomes: readonly FinalOutcome[], runCount: number): HistogramBucket[] {
  if (finalOutcomes.length === 0 || runCount === 0) return [];
  const values = finalOutcomes.map((o) => ({ value: penceToPounds(o.netWorth), shortfallSeverity: o.shortfallSeverity }));
  const sorted = [...values].sort((a, b) => a.value - b.value);
  const min = sorted[0]?.value ?? 0;
  const max = sorted[sorted.length - 1]?.value ?? 0;
  const p90Value = sorted[Math.min(sorted.length - 1, Math.floor(0.9 * sorted.length))]?.value ?? max;
  const p99Value = sorted[Math.min(sorted.length - 1, Math.floor(0.99 * sorted.length))]?.value ?? max;
  // If the top 10% doesn't actually clear the bottom of the range (e.g. every run landed on the same value), fall back to the true max rather than produce a zero-width bucket range.
  const upperBound = p90Value > min ? p90Value : max;
  // The overflow bucket's *displayed* range tops out at the 99th percentile, not the batch's literal max — the max of a heavy-tailed distribution is an unstable order statistic that simply grows the more runs you simulate, which would otherwise make the bucket's advertised range widen every time "Number of runs" goes up rather than describing anything reproducible.
  const overflowDisplayHigh = p99Value > upperBound ? p99Value : max;
  const bucketWidth = (upperBound - min) / HISTOGRAM_BUCKET_COUNT || 1;

  const buckets = Array.from({ length: HISTOGRAM_BUCKET_COUNT }, () => ({ successCount: 0, recoverableCount: 0, shortfallCount: 0 }));
  const overflow = { successCount: 0, recoverableCount: 0, shortfallCount: 0 };
  for (const { value, shortfallSeverity } of values) {
    const target =
      value > upperBound ? overflow : (buckets[Math.min(HISTOGRAM_BUCKET_COUNT - 1, Math.floor((value - min) / bucketWidth))] ?? overflow);
    if (shortfallSeverity === "depleted") target.shortfallCount += 1;
    else if (shortfallSeverity === "recoverable") target.recoverableCount += 1;
    else target.successCount += 1;
  }

  const result: HistogramBucket[] = buckets.map((bucket, i) => {
    const rangeLow = min + i * bucketWidth;
    const rangeHigh = rangeLow + bucketWidth;
    return {
      rangeLow,
      rangeHigh,
      label: formatMoneyRounded(rangeLow),
      successPct: (bucket.successCount / runCount) * 100,
      recoverablePct: (bucket.recoverableCount / runCount) * 100,
      shortfallPct: (bucket.shortfallCount / runCount) * 100,
      successCount: bucket.successCount,
      recoverableCount: bucket.recoverableCount,
      shortfallCount: bucket.shortfallCount,
    };
  });

  if (overflow.successCount + overflow.recoverableCount + overflow.shortfallCount > 0) {
    // A blank spacer bin first, so the overflow bar reads as visually
    // separate from the regular, equal-width bins rather than as their
    // (misleadingly taller) continuation.
    result.push({
      rangeLow: upperBound,
      rangeHigh: upperBound,
      label: "",
      successPct: 0,
      recoverablePct: 0,
      shortfallPct: 0,
      successCount: 0,
      recoverableCount: 0,
      shortfallCount: 0,
      isSpacer: true,
    });
    result.push({
      rangeLow: upperBound,
      rangeHigh: overflowDisplayHigh,
      label: "Top 10%",
      successPct: (overflow.successCount / runCount) * 100,
      recoverablePct: (overflow.recoverableCount / runCount) * 100,
      shortfallPct: (overflow.shortfallCount / runCount) * 100,
      successCount: overflow.successCount,
      recoverableCount: overflow.recoverableCount,
      shortfallCount: overflow.shortfallCount,
      isOverflow: true,
      trueMax: max,
    });
  }

  return result;
}

function HistogramTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]?.payload as HistogramBucket | undefined;
  if (!bucket || bucket.isSpacer) return null;
  const totalPct = bucket.successPct + bucket.recoverablePct + bucket.shortfallPct;
  return (
    <Card withBorder padding="xs" shadow="md">
      <Stack gap={2}>
        <Text size="sm" fw={700}>
          {formatMoneyRounded(bucket.rangeLow)} – {formatMoneyRounded(bucket.rangeHigh)}
        </Text>
        <Text size="xs" fw={600}>
          {formatPercent(totalPct / 100)} of runs ended in this range
        </Text>
        {bucket.successCount > 0 && (
          <Text size="xs" c="green">
            {bucket.successCount} never missed a year&rsquo;s target income
          </Text>
        )}
        {bucket.recoverableCount > 0 && (
          <Text size="xs" c="yellow.8">
            {bucket.recoverableCount} missed a year&rsquo;s target income, but still had money elsewhere (e.g. a locked pension)
          </Text>
        )}
        {bucket.shortfallCount > 0 && (
          <Text size="xs" c="red">
            {bucket.shortfallCount} genuinely ran out of money at some point
          </Text>
        )}
        {bucket.isOverflow && (
          <Text size="xs" c="dimmed" maw={220}>
            This bar pools everything above the 90th percentile — a much wider £ range than the other bars, so its
            height isn&rsquo;t directly comparable to theirs. Shown up to the 99th percentile; a handful of rarer runs
            go higher still{bucket.trueMax !== undefined && bucket.trueMax > bucket.rangeHigh ? `, up to ${formatMoneyRounded(bucket.trueMax)} in the most extreme single case` : ""}.
          </Text>
        )}
      </Stack>
    </Card>
  );
}

interface PercentileOutcomeBucket {
  readonly label: string;
  readonly rangeLow: number;
  readonly rangeHigh: number;
  readonly successPct: number;
  readonly recoverablePct: number;
  readonly shortfallPct: number;
  readonly successCount: number;
  readonly recoverableCount: number;
  readonly shortfallCount: number;
  /**
   * Original (pre-sort) index of each run in this bucket, into the same
   * `finalOutcomes` array this was built from — not derivable from
   * `rangeLow`/`rangeHigh` alone. With many runs tied at the same value
   * (e.g. a big cluster ending at exactly £0), several adjacent buckets
   * can share an overlapping £ range, so membership has to be tracked by
   * rank/index directly rather than re-derived from a value comparison
   * against the range (which would double-count tied runs across
   * buckets).
   */
  readonly runIndices: readonly number[];
}

/**
 * A different cut on the same `finalOutcomes` the £-value histogram above
 * uses — ranked by *percentile*, not by £ amount. Sorts every run by its
 * end-of-plan net worth and splits them into `PERCENTILE_HISTOGRAM_BUCKET_COUNT`
 * equal-*count* buckets (deciles, by default) rather than equal-£-width
 * ones, so — unlike the value histogram — there's no long-tail bucket-width
 * problem to solve and no overflow bucket needed: every bucket holds
 * exactly the same fraction of runs by construction. Each bucket's bar is
 * normalized to its *own* 100% (not a share of all runs, which would be a
 * fixed ~1/bucketCount for every bucket and make the shortfall split hard
 * to read) — so the chart directly answers "what fraction of runs ranked
 * in this percentile band ever ran out of money," decile by decile,
 * making a sharp success/shortfall cutoff (or its absence) immediately
 * visible.
 */
function buildPercentileHistogram(finalOutcomes: readonly FinalOutcome[], bucketCount: number = PERCENTILE_HISTOGRAM_BUCKET_COUNT): PercentileOutcomeBucket[] {
  if (finalOutcomes.length === 0) return [];
  const sorted = [...finalOutcomes]
    .map((o, originalIndex) => ({ value: penceToPounds(o.netWorth), shortfallSeverity: o.shortfallSeverity, originalIndex }))
    .sort((a, b) => a.value - b.value);
  const n = sorted.length;
  const step = 100 / bucketCount;

  return Array.from({ length: bucketCount }, (_, i) => {
    const startIndex = Math.floor((i * n) / bucketCount);
    const endIndex = Math.floor(((i + 1) * n) / bucketCount);
    const slice = sorted.slice(startIndex, endIndex);
    const shortfallCount = slice.filter((s) => s.shortfallSeverity === "depleted").length;
    const recoverableCount = slice.filter((s) => s.shortfallSeverity === "recoverable").length;
    const successCount = slice.length - shortfallCount - recoverableCount;
    return {
      label: `${Math.round(i * step)}-${Math.round((i + 1) * step)}th`,
      rangeLow: slice[0]?.value ?? 0,
      rangeHigh: slice[slice.length - 1]?.value ?? slice[0]?.value ?? 0,
      successPct: slice.length > 0 ? (successCount / slice.length) * 100 : 0,
      recoverablePct: slice.length > 0 ? (recoverableCount / slice.length) * 100 : 0,
      shortfallPct: slice.length > 0 ? (shortfallCount / slice.length) * 100 : 0,
      successCount,
      recoverableCount,
      shortfallCount,
      runIndices: slice.map((s) => s.originalIndex),
    };
  });
}

function PercentileHistogramTooltip({ active, payload }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  const bucket = payload[0]?.payload as PercentileOutcomeBucket | undefined;
  if (!bucket) return null;
  return (
    <Card withBorder padding="xs" shadow="md">
      <Stack gap={2}>
        <Text size="sm" fw={700}>
          {bucket.label} percentile
        </Text>
        <Text size="xs" c="dimmed">
          Ended between {formatMoneyRounded(bucket.rangeLow)} and {formatMoneyRounded(bucket.rangeHigh)}
        </Text>
        {bucket.successCount > 0 && (
          <Text size="xs" c="green">
            {formatPercent(bucket.successPct / 100)} ({bucket.successCount}) never missed a year&rsquo;s target income
          </Text>
        )}
        {bucket.recoverableCount > 0 && (
          <Text size="xs" c="yellow.8">
            {formatPercent(bucket.recoverablePct / 100)} ({bucket.recoverableCount}) missed a year, but had money
            elsewhere
          </Text>
        )}
        {bucket.shortfallCount > 0 && (
          <Text size="xs" c="red">
            {formatPercent(bucket.shortfallPct / 100)} ({bucket.shortfallCount}) genuinely ran out of money
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/**
 * The subset of Recharts' custom `dot` render props actually used below —
 * typed loosely (matching Recharts' own `LineDot` function signature,
 * which is untyped `(props: any) => ReactElement`) since these are
 * supplied by Recharts internally at render time, not something this
 * codebase constructs.
 */
interface ShortfallDotProps {
  readonly cx?: number;
  readonly cy?: number;
  readonly index?: number;
  readonly key?: string;
}

/**
 * A small X mark drawn over a line's own point for a year that
 * specifically had a shortfall (`sampleShortfallYears`), rather than just
 * colouring the whole line by whether it shortfell *at all*
 * (`finalOutcomes[i].shortfallSeverity`) — pinpoints which year(s) along
 * an otherwise-recovering path actually missed the target income, and
 * whether that particular year still had money sitting elsewhere
 * (yellow) or was genuinely out (red). Renders an empty (invisible) group
 * for every non-shortfall point, since Recharts' custom `dot` render prop
 * is called once per data point on the line and must always return a
 * valid SVG element, not `null`/`undefined`.
 */
function ShortfallYearMarker({ cx, cy, index, severity }: ShortfallDotProps & { readonly severity: "none" | "recoverable" | "depleted" }) {
  if (severity === "none" || cx === undefined || cy === undefined) return <g key={index} />;
  const size = 4;
  const color = severity === "depleted" ? SHORTFALL_COLOR : RECOVERABLE_COLOR;
  return (
    <g key={index}>
      <line x1={cx - size} y1={cy - size} x2={cx + size} y2={cy + size} stroke={color} strokeWidth={1.5} />
      <line x1={cx - size} y1={cy + size} x2={cx + size} y2={cy - size} stroke={color} strokeWidth={1.5} />
    </g>
  );
}

/** Same tax-year-string convention `runProjection.ts` builds internally — the percentile arrays this page charts carry no labels of their own, just one entry per year index. */
function taxYearForIndex(startCalendarYear: number, yearIndex: number): string {
  const calendarYear = startCalendarYear + yearIndex;
  return `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
}

const ASSET_CLASS_LABELS: Record<AssetClass, string> = { usEquities: "US equities", ukEquities: "UK equities", bonds: "Bonds", cash: "Cash" };

/** Arithmetic mean of a real annual return series — what "Monte Carlo" mode's own defaults are computed from (`stochastic/assetClasses.ts`). */
function arithmeticMean(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Compound annual growth rate — what a real historical £1 invested across the whole series would have actually returned per year, which is generally lower than the arithmetic mean of a volatile series (Jensen's inequality). Takes monthly returns and annualizes accordingly. */
function compoundAnnualGrowthRate(monthlyValues: readonly number[]): number {
  const finalMultiple = monthlyValues.reduce((product, r) => product * (1 + r), 1);
  return Math.pow(finalMultiple, 12 / monthlyValues.length) - 1;
}

/** Arithmetic mean of a monthly return series, annualized by multiplying by 12 — the simple (not compounded) approximation, for display alongside the compound figure above. */
function arithmeticMeanAnnualized(monthlyValues: readonly number[]): number {
  return arithmeticMean(monthlyValues) * 12;
}

function monthLabel(row: { readonly year: number; readonly month: number } | undefined): string {
  return row ? `${row.year}-${String(row.month).padStart(2, "0")}` : "";
}

const ACCOUNT_KIND_LABELS: Record<string, string> = { pension: "Pension", isa: "ISA", gia: "GIA" };

function ownerSuffix(owner: Owner, people: readonly Person[]): string {
  if (people.length <= 1) return "";
  if (owner === "joint") return " (Joint)";
  return owner === people[0]?.id ? " (You)" : " (Them)";
}

function accountLabel(account: Account, people: readonly Person[]): string {
  const kind = ACCOUNT_KIND_LABELS[account.kind] ?? "Account";
  return `${kind}${ownerSuffix(account.owner, people)} — ${formatMoneyRounded(penceToPounds(account.currentBalance))}`;
}

type RiskProfileKey = keyof typeof RISK_PROFILE_PRESETS;

const RISK_PROFILE_OPTIONS: readonly { readonly value: RiskProfileKey | "custom"; readonly label: string }[] = [
  { value: "cash", label: "Cash / near-cash" },
  { value: "cautious", label: "Cautious (20% equities)" },
  { value: "balanced", label: "Balanced (50% equities)" },
  { value: "adventurous", label: "Adventurous (85% equities)" },
  { value: "allEquities", label: "All equities (100%)" },
  { value: "custom", label: "Custom %" },
];

/** Matches on the equities/bonds/cash split only — `equityMarket` is an independent choice shown regardless of preset/custom mode, not part of what makes a preset "match" (see `AssetAllocationInput`). */
function matchingRiskProfileKey(allocation: AssetAllocation): RiskProfileKey | "custom" {
  const match = (Object.keys(RISK_PROFILE_PRESETS) as RiskProfileKey[]).find((key) => {
    const preset = RISK_PROFILE_PRESETS[key];
    return preset.equities === allocation.equities && preset.bonds === allocation.bonds && preset.cash === allocation.cash;
  });
  return match ?? "custom";
}

const EQUITY_MARKET_OPTIONS: readonly { readonly value: AssetAllocation["equityMarket"]; readonly label: string }[] = [
  { value: "us", label: "US equities (S&P 500 in GBP)" },
  { value: "uk", label: "UK equities (FTSE 100)" },
];

/**
 * How one account's balance is invested — read only by this page's own
 * simulations, never by the deterministic projection, which always uses
 * the account's own flat `annualGrowthRate` regardless of this. Lives
 * inline here (rather than on the account-editing page) since this is
 * the only place it's actually used. The preset/custom mode is local UI
 * state, not persisted — only the resulting percentages (`AssetAllocation`)
 * are stored, on the account itself, same as every other account field.
 */
function AssetAllocationInput({ allocation, onChange }: { readonly allocation: AssetAllocation; readonly onChange: (allocation: AssetAllocation) => void }) {
  const [mode, setMode] = useState<RiskProfileKey | "custom">(() => matchingRiskProfileKey(allocation));

  return (
    <Stack gap="xs">
      <Group grow align="flex-end">
        <Select
          label="Investment mix"
          data={RISK_PROFILE_OPTIONS}
          value={mode}
          allowDeselect={false}
          onChange={(value) => {
            if (!value) return;
            const key = value as RiskProfileKey | "custom";
            setMode(key);
            // Preserve the account's own equityMarket choice — the preset only sets the equities/bonds/cash split.
            if (key !== "custom") onChange({ ...RISK_PROFILE_PRESETS[key], equityMarket: allocation.equityMarket });
          }}
        />
        <Select
          label="Equity type"
          data={EQUITY_MARKET_OPTIONS}
          value={allocation.equityMarket}
          allowDeselect={false}
          onChange={(v) => v && onChange({ ...allocation, equityMarket: v as AssetAllocation["equityMarket"] })}
        />
      </Group>
      {mode === "custom" && (
        <Group grow>
          <NumberInput
            label="Equities %"
            rightSection="%"
            value={Math.round(allocation.equities * 100)}
            onChange={(v) => onChange({ ...allocation, equities: typeof v === "number" ? v / 100 : 0 })}
          />
          <NumberInput
            label="Bonds %"
            rightSection="%"
            value={Math.round(allocation.bonds * 100)}
            onChange={(v) => onChange({ ...allocation, bonds: typeof v === "number" ? v / 100 : 0 })}
          />
          <NumberInput
            label="Cash %"
            rightSection="%"
            value={Math.round(allocation.cash * 100)}
            onChange={(v) => onChange({ ...allocation, cash: typeof v === "number" ? v / 100 : 0 })}
          />
        </Group>
      )}
    </Stack>
  );
}

/** Same three-way x-axis choice as the main projection chart (`ProjectionResults.tsx`'s `RowAxisMode`) — kept as this page's own small local copy rather than a shared export, since nothing else needs it. */
type AxisMode = "taxYear" | "myAge" | "otherAge";

function axisModeOptions(people: readonly Person[]): readonly { readonly value: AxisMode; readonly label: string }[] {
  return [
    { value: "taxYear", label: "Tax year" },
    { value: "myAge", label: people.length > 1 ? "My age" : "Age" },
    ...(people.length > 1 ? [{ value: "otherAge" as const, label: "Their age" }] : []),
  ];
}

function personForAxisMode(axisMode: AxisMode, people: readonly Person[]): Person | undefined {
  if (axisMode === "myAge") return people[0];
  if (axisMode === "otherAge") return people[1];
  return undefined;
}

function xAxisLabelForIndex(yearIndex: number, axisMode: AxisMode, people: readonly Person[], startCalendarYear: number): string {
  const calendarYear = startCalendarYear + yearIndex;
  const person = personForAxisMode(axisMode, people);
  return person ? String(ageAtYear(person.dateOfBirth, calendarYear)) : taxYearForIndex(startCalendarYear, yearIndex);
}

/**
 * A deliberately separate page, not a mode on the main projection chart
 * (`ProjectionResults.tsx`) — that page stays the single deterministic
 * line used to actually build and shape a plan; this page is a distinct
 * tool you jump to afterwards, to stress-test how probable that plan
 * actually is against real/simulated market variability (SPEC.md's
 * "Stochastic projections" section). Runs off the main thread via
 * `workers/stochasticProjection.worker.ts` since a batch of hundreds to
 * thousands of full projections would otherwise freeze the page.
 */
export function StochasticProjection() {
  const scenario = useScenarioStore((s) => s.scenario);
  const updateScenario = useScenarioStore((s) => s.updateScenario);
  const navigate = useNavigate();

  const [method, setMethod] = useState<StochasticMethod>("historical");
  const [runCount, setRunCount] = useState("500");
  const [axisMode, setAxisMode] = useState<AxisMode>("taxYear");
  const [showSamplePaths, setShowSamplePaths] = useState(false);
  const [yAxisScaleMode, setYAxisScaleMode] = useState<"p90" | "deterministic2x" | "deterministic4x">("p90");
  const [selectedBucketIndex, setSelectedBucketIndex] = useState<number | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "done">("idle");
  const [progress, setProgress] = useState({ completed: 0, total: 0 });
  const [result, setResult] = useState<StochasticBatchResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Belt-and-braces cleanup if the user navigates away mid-run.
  useEffect(() => () => workerRef.current?.terminate(), []);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  const confirmedRuleSet = getLatestConfirmedRuleSet();
  const startCalendarYear = new Date(confirmedRuleSet.effectiveFrom).getUTCFullYear();

  const historicalReturns = listHistoricalReturns();
  const historicalSources = listHistoricalReturnsSources();
  const usEquityReturns = listUsEquityReturns();
  const usEquitySources = listUsEquityReturnsSources();

  const eligibleAccounts = scenario.accounts.filter(isStochasticEligible);
  const updateAccountAllocation = (accountId: string, allocation: AssetAllocation) => {
    updateScenario((s) => ({ ...s, accounts: s.accounts.map((a) => (a.id === accountId ? { ...a, assetAllocation: allocation } : a)) }));
  };

  // Mirrors runStochasticBatch.ts's own usesUsEquities check — Historical bootstrap replaces the
  // "Number of runs" choice with an exhaustive walk through every real US-equities window whenever
  // this is true, so the dropdown becomes inert and should say so rather than silently being ignored.
  const usesUsEquities = eligibleAccounts.some((a) => {
    const allocation = a.assetAllocation ?? DEFAULT_ASSET_ALLOCATION;
    return allocation.equities > 0 && allocation.equityMarket === "us";
  });
  const runCountOverridden = method === "historical" && usesUsEquities;

  const runSimulation = () => {
    workerRef.current?.terminate();
    const numberOfYears = projectionYearsFor(scenario, startCalendarYear);
    const totalRuns = Number(runCount);

    const worker = new Worker(new URL("../workers/stochasticProjection.worker.js", import.meta.url), { type: "module" });
    workerRef.current = worker;
    setStatus("running");
    setResult(null);
    setSelectedBucketIndex(null);
    setProgress({ completed: 0, total: totalRuns });

    worker.onmessage = (event: MessageEvent<StochasticWorkerMessage>) => {
      const message = event.data;
      if (message.kind === "progress") {
        setProgress({ completed: message.completed, total: message.total });
      } else {
        setResult(message.result);
        setStatus("done");
        worker.terminate();
        workerRef.current = null;
      }
    };

    const request: StochasticWorkerRequest = { scenario, confirmedRuleSet, numberOfYears, method, runCount: totalRuns };
    worker.postMessage(request);
  };

  // Same scenario, same deterministic engine (`computeProjection`) the main
  // projection page itself uses — plotted alongside the percentile bands
  // so the gap between "one smooth assumed rate" and "a real spread of
  // simulated market histories" is visible on this page directly, rather
  // than requiring a manual comparison against the other page's numbers.
  const deterministicNetWorthByYear = result ? computeProjection(scenario).rows.map((row) => penceToPounds(computeNetWorth(row))) : [];

  const sampleTrajectories = result?.sampleTrajectories ?? [];
  const chartData = (result?.netWorthPercentilesByYear ?? []).map((p, i) => {
    const p10 = penceToPounds(p.p10);
    const p15 = penceToPounds(p.p15);
    const p25 = penceToPounds(p.p25);
    const p50 = penceToPounds(p.p50);
    const p75 = penceToPounds(p.p75);
    const p85 = penceToPounds(p.p85);
    const p90 = penceToPounds(p.p90);
    const samplePathValues = Object.fromEntries(
      sampleTrajectories.map((trajectory, runIndex) => [`run${runIndex}`, penceToPounds(trajectory[i] ?? zeroPence())]),
    );
    return {
      year: xAxisLabelForIndex(i, axisMode, scenario.household.people, startCalendarYear),
      deterministic: deterministicNetWorthByYear[i] ?? 0,
      p10,
      p15,
      p25,
      p50,
      p75,
      p85,
      p90,
      outerBand: p90 - p10,
      innerBand: p75 - p25,
      ...samplePathValues,
    };
  });

  const finalYear = chartData.at(-1);
  const histogramData = result ? buildHistogram(result.finalOutcomes, result.runCount) : [];
  const percentileHistogramData = result ? buildPercentileHistogram(result.finalOutcomes) : [];

  // Only `sampleTrajectories.length` runs, spread evenly across the outcome distribution (not just
  // "the first N simulated" — see StochasticBatchResult.sampledRunIndices's doc comment), have a
  // full year-by-year trajectory to plot at all. A clicked bucket's matches are its own `runIndices`
  // (indices into `finalOutcomes`) mapped to their *position* within the sampled subset, via this
  // reverse lookup — `finalOutcomes` index and sample position are no longer the same number now
  // that the sample isn't just a contiguous prefix. Filtering by index (not by re-checking each
  // run's value against rangeLow/rangeHigh) matters when many runs are tied at the same value — e.g.
  // a big cluster ending at exactly £0 can span several adjacent buckets' ranges, and a value check
  // alone would double-count those runs into every bucket whose range happens to include that value.
  const sampledPositionByRunIndex = new Map((result?.sampledRunIndices ?? []).map((runIndex, position) => [runIndex, position]));
  const selectedBucket = selectedBucketIndex !== null ? (percentileHistogramData[selectedBucketIndex] ?? null) : null;
  const matchingRunIndices = selectedBucket
    ? selectedBucket.runIndices.map((i) => sampledPositionByRunIndex.get(i)).filter((position): position is number => position !== undefined)
    : [];

  // Capped at the 90th percentile band (with a little headroom) by
  // default, not the chart's true data max — individual sample paths
  // (when shown) can run to many times the 90th percentile on a long,
  // volatile, 100%-equities horizon, and letting the axis auto-scale to
  // that would crush the p10-p90 band, median, and deterministic line —
  // the parts actually worth reading — into an unreadable sliver at the
  // bottom. The "N× deterministic line" alternatives cap relative to the
  // deterministic line's own peak instead, for a scenario where even the
  // 90th-percentile band dwarfs the deterministic line enough to still
  // flatten the detail near it.
  const maxP90 = Math.max(0, ...chartData.map((row) => row.p90));
  const maxDeterministic = Math.max(0, ...chartData.map((row) => row.deterministic));
  const deterministicMultiple = yAxisScaleMode === "deterministic4x" ? 4 : 2;
  const yAxisMax =
    yAxisScaleMode === "p90"
      ? maxP90 > 0
        ? maxP90 * 1.1
        : undefined
      : maxDeterministic > 0
        ? maxDeterministic * deterministicMultiple
        : undefined;

  return (
    <Stack maw={900} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Confidence</Title>
        <Group gap="xs">
          <OpenFromFileButton />
          <PlanShareControls scenario={scenario} />
          <Button variant="default" size="xs" onClick={() => void navigate("/")}>
            Back to projection
          </Button>
          <AboutDialog />
          <ColorSchemeToggle />
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Re-runs your plan hundreds or thousands of times under randomized investment returns — resampled from real
        historical market history — to see how much your plan&rsquo;s outcome depends on the sequence of returns you
        actually get, not just the single average growth rate the main projection assumes. Only Pension, ISA, and GIA
        balances vary here; cash and property stay on their own flat rate.
      </Alert>

      {eligibleAccounts.length > 0 && (
        <Stack gap="sm">
          <Text fw={600}>Investment mix</Text>
          {eligibleAccounts.map((account) => (
            <Card key={account.id} withBorder padding="sm">
              <Stack gap="xs">
                <Text size="sm" fw={500}>
                  {accountLabel(account, scenario.household.people)}
                </Text>
                <AssetAllocationInput
                  allocation={account.assetAllocation ?? DEFAULT_ASSET_ALLOCATION}
                  onChange={(v) => updateAccountAllocation(account.id, v)}
                />
                {/* "Monte Carlo mean: X%" note removed while Monte Carlo mode is hidden from the Method
                    select above (it's meaningless for Historical bootstrap, which doesn't use
                    annualGrowthRate at all). Restore alongside the Select option if MC comes back:
                    Monte Carlo mean: <strong>{formatPercent(account.annualGrowthRate)}</strong> — this
                    account's own growth rate, the same base figure the deterministic projection uses,
                    so its Monte Carlo median starts from the same assumption as the deterministic line. */}
              </Stack>
            </Card>
          ))}
        </Stack>
      )}

      <Group align="flex-end" gap="xl">
        <Select
          label="Method"
          // "montecarlo" is deliberately omitted from this list — not deleted. It's a fully working
          // StochasticMethod (pure per-year random walk, mean tied to each account's own
          // annualGrowthRate, Student's-t fat tails for bonds/cash — see runStochasticBatch.ts and
          // the "Data & assumptions used" accordion below) but its output wasn't judged helpful
          // enough yet to surface to users. Add `{ value: "montecarlo", label: "Monte Carlo
          // (statistical model)" }` back here to re-enable it; `method` state already accepts it.
          data={[{ value: "historical", label: "Historical bootstrap (real market history)" }]}
          value={method}
          allowDeselect={false}
          onChange={(v) => v && setMethod(v as StochasticMethod)}
          w={340}
        />
        <Select
          label="Number of runs"
          description={runCountOverridden ? "Overridden — see below" : undefined}
          data={RUN_COUNT_OPTIONS}
          value={runCount}
          allowDeselect={false}
          disabled={runCountOverridden}
          onChange={(v) => v && setRunCount(v)}
          w={140}
        />
        <Button onClick={runSimulation} loading={status === "running"}>
          Run simulation
        </Button>
      </Group>
      {runCountOverridden && (
        <Text size="xs" c="dimmed">
          At least one account&rsquo;s Equity type is US, so Historical bootstrap runs an exhaustive backtest instead — exactly once per
          real historical window your plan&rsquo;s length fits into the US equities data, rather than a random sample sized by
          &ldquo;Number of runs&rdquo; (which is ignored here). See &ldquo;Data &amp; assumptions used&rdquo; below for details.
        </Text>
      )}

      {status === "running" && (
        <Stack gap={4}>
          <Progress value={progress.total > 0 ? (progress.completed / progress.total) * 100 : 0} animated />
          <Text size="xs" c="dimmed">
            {progress.completed} / {progress.total} simulated market histories
          </Text>
        </Stack>
      )}

      {result && (
        <>
          <Alert color={result.successRate === 1 ? "green" : "yellow"} variant="light">
            Funded without a shortfall in <strong>{formatPercent(result.successRate)}</strong> of {result.runCount}{" "}
            simulated market histories.
            {result.successRate < 1 &&
              (() => {
                const depletedCount = result.finalOutcomes.filter((o) => o.shortfallSeverity === "depleted").length;
                const recoverableCount = result.finalOutcomes.filter((o) => o.shortfallSeverity === "recoverable").length;
                return (
                  <>
                    {" "}
                    <Text span c="red" fw={700}>
                      {formatPercent(depletedCount / result.runCount)}
                    </Text>{" "}
                    genuinely ran out of money at some point
                    {recoverableCount > 0 && (
                      <>
                        {"; "}
                        <Text span c="yellow.8" fw={700}>
                          {formatPercent(recoverableCount / result.runCount)}
                        </Text>{" "}
                        missed a year&rsquo;s target income but still had money elsewhere (e.g. locked in a pension)
                      </>
                    )}
                    .
                  </>
                );
              })()}
          </Alert>
          {finalYear && (
            <Text size="sm" c="dimmed">
              By the end of the plan, half of all simulated histories ended between{" "}
              <strong>{formatMoneyRounded(finalYear.p25)}</strong> and <strong>{formatMoneyRounded(finalYear.p75)}</strong> (median{" "}
              {formatMoneyRounded(finalYear.p50)}), and 80% ended somewhere between <strong>{formatMoneyRounded(finalYear.p10)}</strong>{" "}
              and <strong>{formatMoneyRounded(finalYear.p90)}</strong> — the histogram below shows the full shape of that
              spread, rather than just those five cut points.
            </Text>
          )}
          <Group justify="space-between" align="flex-end" wrap="wrap" gap="md">
            <Switch
              label={`Show individual simulated paths (${
                sampleTrajectories.length === result.runCount ? `all ${sampleTrajectories.length}` : `a sample of ${sampleTrajectories.length}`
              })`}
              checked={showSamplePaths}
              onChange={(e) => setShowSamplePaths(e.currentTarget.checked)}
            />
            <Group gap="md">
              <Select
                label="Y-axis max"
                data={[
                  { value: "p90", label: "Auto (90th percentile)" },
                  { value: "deterministic2x", label: "2× deterministic line" },
                  { value: "deterministic4x", label: "4× deterministic line" },
                ]}
                value={yAxisScaleMode}
                onChange={(v) =>
                  setYAxisScaleMode(v === "deterministic2x" || v === "deterministic4x" ? v : "p90")
                }
                allowDeselect={false}
                w={190}
              />
              <Select
                label="Show"
                data={axisModeOptions(scenario.household.people)}
                value={axisMode}
                onChange={(v) => setAxisMode(v === "myAge" || v === "otherAge" ? v : "taxYear")}
                allowDeselect={false}
                w={160}
              />
            </Group>
          </Group>
          <div style={{ width: "100%", height: 420 }}>
            <ResponsiveContainer>
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="year" />
                <YAxis
                  tickFormatter={(v: number) => formatMoneyRounded(v)}
                  width={90}
                  domain={[0, yAxisMax ?? "auto"]}
                  allowDataOverflow
                />
                {!showSamplePaths && <Tooltip content={ConfidenceTooltip} />}
                <Legend />
                <Area dataKey="p10" stackId="outer" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" />
                <Area dataKey="outerBand" stackId="outer" stroke="none" fill={CHART_COLOR} fillOpacity={0.12} isAnimationActive={false} name="10th-90th percentile" />
                <Area dataKey="p25" stackId="inner" stroke="none" fill="transparent" isAnimationActive={false} legendType="none" />
                <Area dataKey="innerBand" stackId="inner" stroke="none" fill={CHART_COLOR} fillOpacity={0.22} isAnimationActive={false} name="25th-75th percentile" />
                <Line dataKey="p85" stroke={CHART_COLOR} strokeWidth={1} strokeDasharray="2 3" dot={false} isAnimationActive={false} name="85th percentile" />
                <Line dataKey="p15" stroke={CHART_COLOR} strokeWidth={1} strokeDasharray="2 3" dot={false} isAnimationActive={false} name="15th percentile" />
                {showSamplePaths &&
                  sampleTrajectories.map((_, runIndex) => (
                    <Line
                      key={runIndex}
                      dataKey={`run${runIndex}`}
                      stroke={CHART_COLOR}
                      strokeWidth={1}
                      strokeOpacity={0.18}
                      dot={false}
                      isAnimationActive={false}
                      legendType="none"
                      tooltipType="none"
                    />
                  ))}
                <Line dataKey="p50" stroke={CHART_COLOR} strokeWidth={2} dot={false} isAnimationActive={false} name="Median" />
                <Line
                  dataKey="deterministic"
                  stroke={DETERMINISTIC_COLOR}
                  strokeWidth={2}
                  strokeDasharray="6 4"
                  dot={false}
                  isAnimationActive={false}
                  name="Deterministic"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          {showSamplePaths && (
            <Text size="xs" c="dimmed">
              Each faint line is one individual simulated market history (
              {sampleTrajectories.length === result.runCount
                ? `all ${sampleTrajectories.length} runs`
                : `a sample of ${sampleTrajectories.length} of ${result.runCount} runs, spread evenly across the full range of outcomes`}
              ) — the aggregated bands above summarise these, but the actual paths shown here
              give a feel for how a single history behaves along the way, not just where it ends up. The chart&rsquo;s
              height is capped{" "}
              {yAxisScaleMode === "p90"
                ? "just above the 90th percentile band"
                : `at ${deterministicMultiple} times the deterministic line's own peak`}
              , not the true highest path, so the very best runs may climb off the top of the chart rather than
              squashing everything else flat.
            </Text>
          )}

          <Stack gap="xs">
            <Text fw={600}>Distribution of outcomes at the end of the plan</Text>
            <Text size="xs" c="dimmed">
              Every bar is one slice of the {result.runCount} simulated market histories, grouped by what the plan was
              worth at the end and split by whether that history ever missed a year&rsquo;s target income along the
              way — and, if so, whether money still existed elsewhere at the time (e.g. locked in a pension) or was
              genuinely gone. The faded bar on the right pools the entire top 10% — a much wider range than the
              others — into one bar, so it isn&rsquo;t a second cluster of outcomes, just everything above the 90th
              percentile shown in one place.
            </Text>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={histogramData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v: number) => `${v}%`} width={50} />
                  <Tooltip content={HistogramTooltip} />
                  <Legend />
                  <Bar dataKey="successPct" stackId="outcome" isAnimationActive={false} name="Never missed a year's target income">
                    {histogramData.map((bucket, i) => (
                      <Cell key={i} fill={SUCCESS_COLOR} fillOpacity={bucket.isOverflow ? 0.45 : 1} />
                    ))}
                  </Bar>
                  <Bar dataKey="recoverablePct" stackId="outcome" isAnimationActive={false} name="Missed a year, but had money elsewhere">
                    {histogramData.map((bucket, i) => (
                      <Cell key={i} fill={RECOVERABLE_COLOR} fillOpacity={bucket.isOverflow ? 0.45 : 1} />
                    ))}
                  </Bar>
                  <Bar dataKey="shortfallPct" stackId="outcome" isAnimationActive={false} name="Genuinely ran out of money">
                    {histogramData.map((bucket, i) => (
                      <Cell key={i} fill={SHORTFALL_COLOR} fillOpacity={bucket.isOverflow ? 0.45 : 1} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Stack>

          <Stack gap="xs">
            <Text fw={600}>Shortfall rate by outcome percentile</Text>
            <Text size="xs" c="dimmed">
              The same {result.runCount} runs, ranked by end-of-plan net worth and split into ten equal-sized
              percentile bands instead of equal £ ranges — each bar is normalized to its own 100%, showing what
              fraction of runs in that band ever missed a year&rsquo;s target income along the way, and whether that
              was recoverable (money still existed elsewhere, e.g. a locked pension) or a genuine depletion,
              wherever that band happened to fall in £ terms. Click a bar to see the individual simulated paths
              behind it.
            </Text>
            <div style={{ width: "100%", height: 280, cursor: "pointer" }}>
              <ResponsiveContainer>
                <BarChart data={percentileHistogramData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="label" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                  <YAxis domain={[0, 100]} ticks={[0, 20, 40, 60, 80, 100]} tickFormatter={(v: number) => `${Math.round(v)}%`} width={50} />
                  <Tooltip content={PercentileHistogramTooltip} />
                  <Legend />
                  <Bar
                    dataKey="successPct"
                    stackId="outcome"
                    fill={SUCCESS_COLOR}
                    isAnimationActive={false}
                    name="Never missed a year's target income"
                    onClick={(_, i) => setSelectedBucketIndex((prev) => (prev === i ? null : i))}
                  >
                    {percentileHistogramData.map((_, i) => (
                      <Cell key={i} stroke={i === selectedBucketIndex ? "#1c1c1c" : "none"} strokeWidth={i === selectedBucketIndex ? 2 : 0} />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="recoverablePct"
                    stackId="outcome"
                    fill={RECOVERABLE_COLOR}
                    isAnimationActive={false}
                    name="Missed a year, but had money elsewhere"
                    onClick={(_, i) => setSelectedBucketIndex((prev) => (prev === i ? null : i))}
                  >
                    {percentileHistogramData.map((_, i) => (
                      <Cell key={i} stroke={i === selectedBucketIndex ? "#1c1c1c" : "none"} strokeWidth={i === selectedBucketIndex ? 2 : 0} />
                    ))}
                  </Bar>
                  <Bar
                    dataKey="shortfallPct"
                    stackId="outcome"
                    fill={SHORTFALL_COLOR}
                    isAnimationActive={false}
                    name="Genuinely ran out of money"
                    onClick={(_, i) => setSelectedBucketIndex((prev) => (prev === i ? null : i))}
                  >
                    {percentileHistogramData.map((_, i) => (
                      <Cell key={i} stroke={i === selectedBucketIndex ? "#1c1c1c" : "none"} strokeWidth={i === selectedBucketIndex ? 2 : 0} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Stack>

          {selectedBucket && (
            <Stack gap="xs">
              <Group justify="space-between">
                <Text fw={600}>Simulated paths in the {selectedBucket.label} percentile</Text>
                <Button variant="subtle" size="xs" onClick={() => setSelectedBucketIndex(null)}>
                  Clear
                </Button>
              </Group>
              <Text size="xs" c="dimmed">
                {matchingRunIndices.length > 0 ? (
                  <>
                    Showing {matchingRunIndices.length} simulated path{matchingRunIndices.length === 1 ? "" : "s"} that
                    ended between <strong>{formatMoneyRounded(selectedBucket.rangeLow)}</strong> and{" "}
                    <strong>{formatMoneyRounded(selectedBucket.rangeHigh)}</strong>
                    {sampleTrajectories.length < result.runCount
                      ? ` — only a sample of ${sampleTrajectories.length} of ${result.runCount} runs' full trajectories
                         are kept for plotting (spread evenly across the full range of outcomes), so this may be fewer
                         than the full ${
                           selectedBucket.successCount + selectedBucket.recoverableCount + selectedBucket.shortfallCount
                         }-run band (re-run with an Equity type of US for guaranteed full coverage, since that mode keeps every run's path).`
                      : "."}{" "}
                    Each line is coloured by that individual run&rsquo;s own outcome —{" "}
                    <Text span c="green" fw={600}>
                      green
                    </Text>{" "}
                    if it never missed a year&rsquo;s target income,{" "}
                    <Text span c="yellow.8" fw={600}>
                      yellow
                    </Text>{" "}
                    if it missed a year but still had money sitting elsewhere (e.g. locked in a pension), and{" "}
                    <Text span c="red" fw={600}>
                      red
                    </Text>{" "}
                    if it was genuinely out of money in at least one year — the small X marks pinpoint exactly which
                    year(s), even if (as here) the run still ended up worth a lot by the end.
                  </>
                ) : (
                  "None of the runs with a saved trajectory fell in this range — only a sample of " +
                  `${sampleTrajectories.length} of ${result.runCount} runs' full trajectories are kept for plotting, ` +
                  "and none of those happened to land here. Try re-running, or use an Equity type of US for guaranteed full coverage."
                )}
              </Text>
              {matchingRunIndices.length > 0 && (
                <div style={{ width: "100%", height: 320 }}>
                  <ResponsiveContainer>
                    <ComposedChart data={chartData}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="year" />
                      <YAxis tickFormatter={(v: number) => formatMoneyRounded(v)} width={90} />
                      {matchingRunIndices.map((i) => {
                        const shortfallYears = result.sampleShortfallYears[i] ?? [];
                        const netWorthByYear = result.sampleTrajectories[i] ?? [];
                        // Per-year severity: a shortfall year is "depleted" if net worth was already
                        // zero/negative that year, "recoverable" if money still existed elsewhere
                        // (e.g. a locked pension) — the same distinction as the run's own overall
                        // `shortfallSeverity`, just resolved year-by-year instead of once for the whole run.
                        const yearSeverity = (yearIndex: number): "none" | "recoverable" | "depleted" => {
                          if (!shortfallYears[yearIndex]) return "none";
                          const netWorth = netWorthByYear[yearIndex];
                          return netWorth !== undefined && netWorth > 0 ? "recoverable" : "depleted";
                        };
                        // The run's overall severity — worst of every year's own severity — computed
                        // directly from this sampled run's own data rather than looked up on
                        // `finalOutcomes` by `i`: `i` here is this run's *position* within the sampled
                        // subset, not its index into `finalOutcomes` (see `sampledPositionByRunIndex`).
                        const severity = shortfallYears.reduce<"none" | "recoverable" | "depleted">((worst, _, yearIndex) => {
                          const thisYear = yearSeverity(yearIndex);
                          if (worst === "depleted" || thisYear === "depleted") return "depleted";
                          if (worst === "recoverable" || thisYear === "recoverable") return "recoverable";
                          return "none";
                        }, "none");
                        return (
                          <Line
                            key={i}
                            dataKey={`run${i}`}
                            stroke={severity === "depleted" ? SHORTFALL_COLOR : severity === "recoverable" ? RECOVERABLE_COLOR : SUCCESS_COLOR}
                            strokeOpacity={0.7}
                            strokeWidth={1.5}
                            dot={(dotProps: ShortfallDotProps) => <ShortfallYearMarker {...dotProps} severity={yearSeverity(dotProps.index ?? -1)} />}
                            isAnimationActive={false}
                            legendType="none"
                          />
                        );
                      })}
                      <Line
                        dataKey="deterministic"
                        stroke={DETERMINISTIC_COLOR}
                        strokeWidth={2}
                        strokeDasharray="6 4"
                        dot={false}
                        isAnimationActive={false}
                        name="Deterministic"
                      />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Stack>
          )}
        </>
      )}

      <Accordion variant="separated">
        <Accordion.Item value="data">
          <Accordion.Control>Data &amp; assumptions used</Accordion.Control>
          <Accordion.Panel>
            <Stack gap="md">
              <Text size="sm" c="dimmed">
                Real (inflation-adjusted) <em>monthly</em> returns across four separate asset classes (US equities,
                UK equities, UK gilts, and cash), used directly by Historical bootstrap mode and to derive Monte
                Carlo mode&rsquo;s own default volatility per asset class — not an independently guessed number. US
                equities are sourced from their own, much longer-running table (
                {monthLabel(usEquityReturns[0])}-{monthLabel(usEquityReturns.at(-1))}) than UK equities/bonds/cash (
                {monthLabel(historicalReturns[0])}-{monthLabel(historicalReturns.at(-1))}) — the two deliberately
                don&rsquo;t share one window, since a US series can be sourced much further back than a genuine UK
                one. The consequence: an account whose Equity type is US draws its equities return independently of
                that same simulated year&rsquo;s bonds/cash return; a UK-equity account keeps them correlated, drawn
                from the same historical month together. UK equities/bonds/cash use a random moving-block bootstrap —
                a random 10-year block of consecutive real months (not necessarily starting in January), compounded
                into simulated years, concatenated until the plan&rsquo;s length is filled; monthly (rather than
                annual) source data means those blocks can start from many more distinct points in history than a
                whole-calendar-year version could. <strong>US equities instead use an exhaustive backtest, not a
                random sample</strong>: every real window of exactly the plan&rsquo;s own length is walked from the
                earliest possible starting month to the latest, one month at a time — every historical outcome that
                length could actually have produced, not a sample of some of them. Because it&rsquo;s exhaustive, the
                number of runs isn&rsquo;t a free choice: it&rsquo;s exactly the number of such windows that exist
                (shown above &ldquo;Number of runs&rdquo; when active), overriding whatever that control says. Monte
                Carlo mode is a pure
                random walk: a fresh, independent draw every single year, deliberately with no block structure or
                persistence borrowed from real history (that&rsquo;s what Historical bootstrap mode is for). This
                makes Monte Carlo&rsquo;s spread of outcomes meaningfully wider than Historical bootstrap&rsquo;s for
                the same volatility figure — compounding independent year-by-year shocks over a 40+-year retirement
                is inherently fatter-tailed than resampling real, persistent multi-year sequences. See sources below.
              </Text>
              <Text size="sm" c="dimmed">
                Monte Carlo mode&rsquo;s mean return isn&rsquo;t one shared figure per asset class — each account uses
                its <em>own</em> <code>annualGrowthRate</code> (shown against each account above, in &ldquo;Investment
                mix&rdquo;) as its Monte Carlo mean, deliberately <em>not</em> the historical average shown below.
                That&rsquo;s the same base rate the deterministic projection uses for that account, so the
                deterministic line and Monte Carlo&rsquo;s median start from the same assumption instead of two
                unrelated ones — a backward-looking multi-decade historical sample mean has no real bearing on what
                Monte Carlo is meant to represent going forward (Historical bootstrap mode already exists to show
                what actually happened).
              </Text>
              <Text size="sm" c="dimmed">
                Bonds and cash also draw a fatter-tailed (Student&rsquo;s t) shock rather than a plain bell curve —
                their real monthly-compounded returns in this dataset show genuine excess kurtosis (more frequent
                large moves than a bell curve predicts). Both equities classes&rsquo; measured kurtosis on this
                dataset comes out <em>below</em> a bell curve&rsquo;s, not above it, so equities keeps a plain
                Gaussian shock — fat tails aren&rsquo;t applied where the data doesn&rsquo;t actually support them.
              </Text>
              <Table withTableBorder>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Asset class</Table.Th>
                    <Table.Th ta="right">Historical arithmetic mean (annualized)</Table.Th>
                    <Table.Th ta="right">Historical compound (CAGR)</Table.Th>
                    <Table.Th ta="right">Monte Carlo volatility (annual)</Table.Th>
                    <Table.Th ta="right">Monte Carlo shock shape</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {(["usEquities", "ukEquities", "bonds", "cash"] as const).map((assetClass) => {
                    const values =
                      assetClass === "usEquities" ? usEquityReturns.map((r) => r.usEquities) : historicalReturns.map((r) => r[assetClass]);
                    const degreesOfFreedom = MONTE_CARLO_DEFAULT_PRESETS[assetClass].degreesOfFreedom;
                    return (
                      <Table.Tr key={assetClass}>
                        <Table.Th>{ASSET_CLASS_LABELS[assetClass]}</Table.Th>
                        <Table.Td ta="right">{formatPercent(arithmeticMeanAnnualized(values))}</Table.Td>
                        <Table.Td ta="right">{formatPercent(compoundAnnualGrowthRate(values))}</Table.Td>
                        <Table.Td ta="right">{formatPercent(MONTE_CARLO_DEFAULT_PRESETS[assetClass].volatility)}</Table.Td>
                        <Table.Td ta="right">
                          {degreesOfFreedom === undefined ? "Gaussian" : `Student's t (${degreesOfFreedom.toFixed(1)} d.f.)`}
                        </Table.Td>
                      </Table.Tr>
                    );
                  })}
                </Table.Tbody>
              </Table>
              <Text size="xs" c="dimmed">
                The historical compound figure is generally lower than the historical arithmetic mean for a volatile
                series — that gap (Jensen&rsquo;s inequality) is expected, not an error; it&rsquo;s the compound
                figure that matches what a real historical investment actually grew by, year over year. Neither
                historical column feeds Monte Carlo mode&rsquo;s own mean (see above) — only its volatility and
                shock shape do.
              </Text>
              <Text size="xs" fw={500}>
                US equities, {monthLabel(usEquityReturns[0])}-{monthLabel(usEquityReturns.at(-1))} ({usEquityReturns.length} months)
              </Text>
              <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Month</Table.Th>
                      <Table.Th ta="right">US equities</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {usEquityReturns.map((row) => (
                      <Table.Tr key={monthLabel(row)}>
                        <Table.Th>{monthLabel(row)}</Table.Th>
                        <Table.Td ta="right">{formatPercent(row.usEquities)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
              <Text size="xs" fw={500}>
                UK equities, bonds &amp; cash, {monthLabel(historicalReturns[0])}-{monthLabel(historicalReturns.at(-1))} (
                {historicalReturns.length} months)
              </Text>
              <div style={{ maxHeight: 320, overflowY: "auto", overflowX: "auto" }}>
                <Table withTableBorder>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>Month</Table.Th>
                      <Table.Th ta="right">UK equities</Table.Th>
                      <Table.Th ta="right">Bonds</Table.Th>
                      <Table.Th ta="right">Cash</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {historicalReturns.map((row) => (
                      <Table.Tr key={monthLabel(row)}>
                        <Table.Th>{monthLabel(row)}</Table.Th>
                        <Table.Td ta="right">{formatPercent(row.ukEquities)}</Table.Td>
                        <Table.Td ta="right">{formatPercent(row.bonds)}</Table.Td>
                        <Table.Td ta="right">{formatPercent(row.cash)}</Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </div>
              <Stack gap={2}>
                <Text size="xs" fw={500}>
                  Sources
                </Text>
                {[...usEquitySources, ...historicalSources].map((source, i) => (
                  <Text size="xs" c="dimmed" key={i}>
                    {source.description} —{" "}
                    <Anchor href={source.url} target="_blank" rel="noreferrer" size="xs">
                      {source.url}
                    </Anchor>
                  </Text>
                ))}
              </Stack>
            </Stack>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Stack>
  );
}
