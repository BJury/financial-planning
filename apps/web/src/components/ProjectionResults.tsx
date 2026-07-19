import {
  penceToPounds,
  subtractPence,
  sumPence,
  totalTaxForYear,
  zeroPence,
  type Account,
  type Owner,
  type Pence,
  type Person,
  type ProjectionResult,
  type Scenario,
  type YearLedgerRow,
} from "@fp/engine";
import { Alert, Button, Center, Group, MultiSelect, Stack, Table, Text, Title, useComputedColorScheme } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { downloadCsv, projectionToCsv } from "../csvExport.js";
import { formatMoney } from "../format.js";
import { InfoTip } from "./InfoTip.js";
import { computeNetWorth, computeProjection } from "../projection.js";

interface ChartMetric {
  readonly key: string;
  readonly label: string;
  /** A fixed colour per metric (not assigned by selection order) so a line's colour never shifts as other lines are added or removed. */
  readonly color: string;
  readonly compute: (row: YearLedgerRow) => number;
  /** Only set for a per-account metric — lets the year-by-year table pick out just the pension/ISA/GIA/cash balance columns without re-deriving account info from the key string. */
  readonly accountKind?: Account["kind"];
}

const CHART_METRICS: readonly ChartMetric[] = [
  { key: "netWorth", label: "Net worth", color: "#1c7ed6", compute: (row) => penceToPounds(computeNetWorth(row)) },
  {
    key: "grossIncome",
    label: "Gross income",
    color: "#0ca678",
    compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.grossIncome))),
  },
  {
    key: "netIncome",
    label: "Net income",
    color: "#2f9e44",
    compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.netIncome))),
  },
  { key: "totalTax", label: "Total tax", color: "#e03131", compute: (row) => penceToPounds(totalTaxForYear(row)) },
];

const ACCOUNT_LINE_COLORS = ["#7048e8", "#ae3ec9", "#f76707", "#1098ad", "#f08c00", "#e64980", "#4263eb", "#37b24d", "#fa5252", "#5c940d"];

/** A fixed pixel width per year-by-year table column (not a percentage) — keeps every column an identical, neatly-aligned width regardless of how many pension/ISA/GIA/cash balance columns get appended, with the table scrolling horizontally (its own wrapping `<div>`) rather than every column being squeezed illegibly narrow. */
const TABLE_COLUMN_WIDTH = 130;

interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly compute: (row: YearLedgerRow) => Pence;
  /** Shows a ⚠ next to the value — only the drawdown and net income columns use this, each keyed off a different shortfall flag than "the figure itself is negative." */
  readonly warningFlag?: (row: YearLedgerRow) => boolean;
  /** Whether this column is even relevant — hidden entirely (not just full of zeroes) when the user hasn't added the underlying income source/drain type at all. Omitted for a column that's always relevant regardless of scenario contents (the tax columns — there's no single catalog type to check for "any tax at all"). */
  readonly isIncluded?: (scenario: Scenario) => boolean;
  /** Overrides the group's own colour for just this one column — used by the two drawdown-source columns, which need to match the Pension/Non-taxable balance columns' colours rather than the rest of the Drawdown group's grape. */
  readonly bg?: string;
}

interface TableColumnGroup {
  readonly label: string;
  /** A Mantine "light" colour token (theme-adaptive — automatically the right shade for light vs dark mode, unlike a fixed hex) — applied to both the header and every body cell in the group, so the colour-coding reads all the way down the table, not just at the top. */
  readonly bg: string;
  readonly columns: readonly TableColumn[];
}

const EXPENSE_DRAIN_TYPES = new Set(["livingExpenses", "oneOffOutflow", "mortgagePayment"]);
const CONTRIBUTION_DRAIN_TYPES = new Set(["isaContribution", "giaContribution", "cashContribution", "pensionContribution"]);

/** Every `DrawdownBucket` a taxable pension withdrawal can land in (SPEC.md §5.7.3) — the four Income Tax bands, as opposed to the one tax-free UFPLS bucket. */
const TAXABLE_PENSION_BUCKETS = new Set(["taxablePersonalAllowance", "taxableBasicRate", "taxableHigherRate", "taxableAdditionalRate"]);

/** The Retirement income target section is always present (SPEC.md §5.7.1) with a £0 default — only counts as "active" once it's actually been given a real target. */
function hasActiveDrawdownTarget(scenario: Scenario): boolean {
  return scenario.incomeSources.some(
    (s) => s.type === "targetDrawdownIncome" && ((s.config as { readonly targetNetAnnualIncome?: number }).targetNetAnnualIncome ?? 0) > 0,
  );
}

/**
 * The year-by-year table's column grouping (SPEC.md §7). One "Income"
 * group holds everything that came in this year, in one left-to-right
 * reading order: taxable sources first (Salary, Rental profit, State
 * Pension — each already its own `PersonYearResult` field, so no engine
 * change was needed), then the one non-taxable source (Tax-free income),
 * then the drawdown source breakdown (From pension/ISA/cash/GIA), then
 * the drawdown net total *last* — a summary of everything already shown
 * to its left in this same group, so it reads as the section's own
 * bottom line rather than another individual source. Every column keeps
 * its individual taxable (teal) / non-taxable (cyan) colouring via its
 * own `bg` override, even though they now share one group label; the
 * total's own grape sets it apart as a summary, not a source. Then
 * outgoings, then the tax columns, then the overall net income/net worth.
 */
const TABLE_COLUMN_GROUPS: readonly TableColumnGroup[] = [
  {
    label: "Income",
    bg: "var(--mantine-color-gray-light)",
    columns: [
      {
        key: "salary",
        label: "Salary",
        compute: (row) => sumPence(row.perPerson.map((p) => p.grossIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "salary"),
      },
      {
        key: "rentalProfit",
        label: "Rental profit",
        compute: (row) => sumPence(row.perPerson.map((p) => p.rentalProfitIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "rentalIncome"),
      },
      {
        key: "statePension",
        label: "State Pension",
        compute: (row) => sumPence(row.perPerson.map((p) => p.statePensionIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "statePension"),
      },
      {
        key: "taxFreeIncome",
        label: "Tax-free income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.taxFreeIncome)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "oneOffInflow"),
      },
      {
        key: "drawdownFromPensionTaxFree",
        label: "Pension (tax-free)",
        // The UFPLS 25% share (SPEC.md §5.7.2, `tax/pensionLumpSum.ts`) —
        // already split out at the bucket level, so no engine change was
        // needed to surface it here.
        compute: (row) =>
          sumPence(row.perPerson.flatMap((p) => p.drawdownBuckets.filter((b) => b.bucket === "taxFreePensionLumpSum").map((b) => b.amount))),
        // Cyan — the same "not taxed" colour as Tax-free income/ISA/cash/GIA,
        // even though this is a pension withdrawal (source ≠ tax treatment).
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "pension"),
      },
      {
        key: "drawdownFromPensionTaxable",
        label: "Pension (taxable)",
        compute: (row) =>
          sumPence(row.perPerson.flatMap((p) => p.drawdownBuckets.filter((b) => TAXABLE_PENSION_BUCKETS.has(b.bucket)).map((b) => b.amount))),
        // Teal — matches the Pension balance column, and is taxed like
        // ordinary pension income.
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "pension"),
      },
      {
        key: "drawdownFromIsa",
        label: "From ISA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromIsa)),
        // Coloured the same as the Non-taxable balance column.
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "isa"),
      },
      {
        key: "drawdownFromCash",
        label: "From cash",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromCash)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "cash"),
      },
      {
        key: "drawdownFromGia",
        label: "From GIA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromGia)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "gia"),
      },
      {
        key: "drawdown",
        label: "Drawdown income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownNetAchieved)),
        warningFlag: (row) => row.perPerson.some((p) => p.drawdownShortfall),
        // Its own colour, not taxable/non-taxable teal/cyan — it's the
        // net total of everything drawn down this year, not one specific
        // source, so it's set apart rather than made to look like it
        // belongs to either side.
        bg: "var(--mantine-color-grape-light)",
        // The Retirement income target section is always present (SPEC.md
        // §5.7.1) with a £0 default — only counts as "included" once it's
        // actually been given a real target, not just because the
        // permanent section exists on the page.
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario),
      },
      {
        key: "netIncome",
        label: "Net income",
        // Everything that came in this year, net of tax, combined —
        // drawdown plus salary, rental profit, State Pension, and
        // tax-free income. Deliberately *not* the engine's own
        // `PersonYearResult.netIncome` field: that one is further reduced
        // by living expenses/contributions and by auto-consumption
        // (achieving a drawdown target counts as spent, SPEC.md §5.7.2),
        // so it usually settles at/near £0 and doesn't answer "how much
        // came in" — this column recomputes the total from the same
        // already-tracked per-source figures, without those subtractions.
        compute: (row) =>
          subtractPence(
            sumPence(
              row.perPerson.flatMap((p) => [
                p.grossIncome,
                p.rentalProfitIncome,
                p.statePensionIncome,
                p.drawdownNetAchieved,
                p.taxFreeIncome,
                p.mortgageInterestCredit,
                p.propertySaleNetProceeds,
              ]),
            ),
            sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.nationalInsurance, p.annualAllowanceCharge, p.savingsTax, p.dividendTax])),
          ),
        warningFlag: (row) => row.perPerson.some((p) => p.livingExpensesShortfall),
        bg: "var(--mantine-color-yellow-light)",
      },
    ],
  },
  {
    label: "Outgoings",
    bg: "var(--mantine-color-orange-light)",
    columns: [
      {
        key: "expenses",
        label: "Expenses",
        compute: (row) => sumPence(row.perPerson.map((p) => p.otherExpenses)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => EXPENSE_DRAIN_TYPES.has(d.type)),
      },
      {
        key: "contributions",
        label: "Contributions",
        compute: (row) => sumPence(row.perPerson.map((p) => p.accountContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => CONTRIBUTION_DRAIN_TYPES.has(d.type)),
      },
    ],
  },
  {
    label: "Tax",
    bg: "var(--mantine-color-red-light)",
    columns: [
      {
        key: "incomeTax",
        label: "Income Tax and NI",
        // NI folded in here rather than kept as its own column — it's
        // never interesting on its own, only as part of the total tax
        // bite on income.
        compute: (row) =>
          subtractPence(
            sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.drawdownIncomeTax, p.savingsTax, p.dividendTax, p.nationalInsurance])),
            sumPence(row.perPerson.map((p) => p.mortgageInterestCredit)),
          ),
      },
      {
        key: "cgt",
        label: "CGT",
        compute: (row) => sumPence(row.perPerson.flatMap((p) => [p.drawdownCapitalGainsTax, p.propertySaleCapitalGainsTax, p.shortfallCapitalGainsTax])),
      },
    ],
  },
];

const ACCOUNT_KIND_LABELS: Partial<Record<Account["kind"], string>> = { pension: "Pension", isa: "ISA", gia: "GIA", cash: "Cash" };

function ownerLabel(owner: Owner, people: readonly Person[]): string {
  if (owner === "joint") return "Joint";
  return people.findIndex((p) => p.id === owner) === 1 ? "Partner" : "You";
}

function accountBaseLabel(account: Account, people: readonly Person[]): string {
  // Only worth distinguishing "whose account is this" once there's more
  // than one person who could own it — a single-person household never
  // needs the suffix.
  const suffix = people.length > 1 ? ` (${ownerLabel(account.owner, people)})` : "";
  if (account.kind === "property") {
    return `${account.propertyType === "rental" ? "Rental" : "Main residence"} equity${suffix}`;
  }
  return `${ACCOUNT_KIND_LABELS[account.kind] ?? "Account"}${suffix}`;
}

/**
 * One selectable chart line per account (SPEC.md §4 journey 6/§7's
 * "bucket-balance graph" ask — seeing which specific pot is depleting,
 * before it's empty, not just after) — a per-*kind* aggregate would hide
 * exactly that: two pensions summed into one line can't show one running
 * out while the other still has headroom. A property's line tracks
 * equity (value minus its own mortgage), matching how net worth already
 * treats it, not raw market value. Colliding labels (e.g. two accounts
 * both landing on "Pension (You)") get a "#2", "#3", ... suffix so every
 * line in the picker is still unique.
 */
function buildAccountMetrics(scenario: Scenario): readonly ChartMetric[] {
  const { people } = scenario.household;
  const baseLabels = scenario.accounts.map((a) => accountBaseLabel(a, people));
  const totalByLabel = new Map<string, number>();
  for (const label of baseLabels) totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1);
  const occurrenceSoFar = new Map<string, number>();

  return scenario.accounts.map((account, index) => {
    const baseLabel = baseLabels[index] ?? "Account";
    const occurrence = (occurrenceSoFar.get(baseLabel) ?? 0) + 1;
    occurrenceSoFar.set(baseLabel, occurrence);
    const label = (totalByLabel.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${occurrence}` : baseLabel;

    return {
      key: `account:${account.id}`,
      label,
      color: ACCOUNT_LINE_COLORS[index % ACCOUNT_LINE_COLORS.length] ?? "#868e96",
      accountKind: account.kind,
      compute: (row: YearLedgerRow) => {
        const balance = penceToPounds(row.accountBalances.get(account.id) ?? zeroPence());
        if (account.kind !== "property") return balance;
        return balance - penceToPounds(row.mortgageBalanceByPropertyId.get(account.id) ?? zeroPence());
      },
    };
  });
}

interface KeyFlag {
  readonly taxYear: string;
  readonly message: string;
}

/**
 * SPEC.md §7's "key flags/warnings" — surfaced once, summarised across
 * the whole plan, rather than requiring the user to scan every row of
 * the year-by-year table for a ⚠. Only the *first* occurrence of each
 * kind is shown per warning type, since a recurring condition (e.g. a
 * shortfall every year from age 80 onward) is one decision to revisit,
 * not dozens of identical lines.
 */
function computeKeyFlags(result: ProjectionResult | null, scenario: Scenario | null): readonly KeyFlag[] {
  if (!result) return [];
  const flags: KeyFlag[] = [];
  const firstTaxYear = result.rows[0]?.taxYear;

  if (scenario && firstTaxYear) {
    const { people } = scenario.household;
    for (const person of people) {
      const hasOwnIncome = scenario.incomeSources.some((source) => source.type !== "targetDrawdownIncome" && source.owner === person.id);
      if (!hasOwnIncome) continue;
      const isCoveredByTarget = scenario.incomeSources.some(
        (source) => source.type === "targetDrawdownIncome" && (source.owner === person.id || source.owner === "joint"),
      );
      if (!isCoveredByTarget) {
        flags.push({
          taxYear: firstTaxYear,
          message: `${ownerLabel(person.id, people)}'s income isn't covered by any drawdown target, so it won't be netted against a target's shortfall.`,
        });
      }
    }
  }

  const firstAnnualAllowanceYear = result.rows.find((row) => row.perPerson.some((p) => p.annualAllowanceCharge > 0));
  if (firstAnnualAllowanceYear) {
    flags.push({
      taxYear: firstAnnualAllowanceYear.taxYear,
      message: "Pension contributions exceed the Annual Allowance, triggering a tax charge.",
    });
  }

  const firstMpaaYear = result.rows.find((row) => row.perPerson.some((p) => p.mpaaActive));
  if (firstMpaaYear) {
    flags.push({
      taxYear: firstMpaaYear.taxYear,
      message: "A pension was flexibly accessed — future pension contributions are now capped at a lower allowance.",
    });
  }

  const firstShortfallYear = result.rows.find((row) => row.perPerson.some((p) => p.drawdownShortfall));
  if (firstShortfallYear) {
    flags.push({
      taxYear: firstShortfallYear.taxYear,
      message: "A drawdown target isn't fully met — available balances run out before the target is reached.",
    });
  }

  const firstNegativeEquityYear = result.rows.find((row) => row.perPerson.some((p) => p.propertySaleNetProceeds < 0));
  if (firstNegativeEquityYear) {
    flags.push({
      taxYear: firstNegativeEquityYear.taxYear,
      message: "A property sale's net proceeds are negative — the outstanding mortgage exceeds the sale price after costs and tax.",
    });
  }

  const firstLivingExpensesShortfallYear = result.rows.find((row) => row.perPerson.some((p) => p.livingExpensesShortfall));
  if (firstLivingExpensesShortfallYear) {
    flags.push({
      taxYear: firstLivingExpensesShortfallYear.taxYear,
      message: "Outgoings exceed income and available cash/ISA/GIA savings — the shortfall isn't fully covered.",
    });
  }

  return flags;
}

interface ChartEvent {
  readonly key: string;
  readonly taxYear: string;
  readonly label: string;
  readonly color: string;
}

/**
 * One-off, dated events (SPEC.md §3.8, §3.9), plus the one recurring
 * milestone worth marking the same way — when drawdown income first
 * actually starts — shown directly on the chart as vertical reference
 * lines. Seeing *why* net worth jumps, dips, or starts declining in a
 * given year (an inheritance landing, a house deposit paid, a property
 * sold, savings starting to be drawn down) is easy to miss buried in the
 * year-by-year table, but hard to miss as a labelled line right on the
 * graph. Maps each one-off event's own date to whichever projection
 * row's `calendarYear` it falls in, the same year-only mapping the
 * engine itself uses (no month-level precision anywhere in this app) —
 * reused here rather than re-derived, so an event's line always lines up
 * with the exact row its amount actually landed in.
 */
function buildChartEvents(scenario: Scenario, result: ProjectionResult): readonly ChartEvent[] {
  const events: ChartEvent[] = [];
  const taxYearForDate = (isoDate: string | undefined): string | undefined => {
    if (!isoDate) return undefined;
    const calendarYear = new Date(isoDate).getUTCFullYear();
    if (Number.isNaN(calendarYear)) return undefined;
    return result.rows.find((row) => row.calendarYear === calendarYear)?.taxYear;
  };

  for (const source of scenario.incomeSources) {
    if (source.type !== "oneOffInflow") continue;
    const taxYear = taxYearForDate((source.config as { readonly date?: string }).date);
    if (!taxYear) continue;
    events.push({ key: `inflow:${source.id}`, taxYear, label: "Inflow", color: "#0ca678" });
  }

  for (const drain of scenario.incomeDrains) {
    if (drain.type !== "oneOffOutflow") continue;
    const taxYear = taxYearForDate((drain.config as { readonly date?: string }).date);
    if (!taxYear) continue;
    events.push({ key: `outflow:${drain.id}`, taxYear, label: "Outflow", color: "#e8590c" });
  }

  for (const account of scenario.accounts) {
    if (account.kind !== "property" || !account.plannedSale) continue;
    const taxYear = taxYearForDate(account.plannedSale.saleDate);
    if (!taxYear) continue;
    events.push({ key: `sale:${account.id}`, taxYear, label: "Sale", color: "#7048e8" });
  }

  // The first year any actual money is drawn (SPEC.md §5.7.2) — not the
  // target's own configured "starts at age", since the target is now
  // netted against salary/State Pension/other automatic income
  // (`adjustDrawdownTargetForAutomaticIncome.ts`) and may stay fully
  // covered by that income for years after the target technically
  // becomes active, with nothing actually drawn yet. Marking the
  // configured start age would be misleading in that case; marking the
  // first real withdrawal is what's actually useful to see on the chart.
  const firstDrawdownYear = result.rows.find((row) => row.perPerson.some((p) => p.drawdownNetAchieved > 0));
  if (firstDrawdownYear) {
    events.push({ key: "drawdown-start", taxYear: firstDrawdownYear.taxYear, label: "Drawdown starts", color: "#1971c2" });
  }

  return events;
}

interface ShortfallRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Consecutive tax years where a drawdown target isn't being fully met
 * (SPEC.md §5.7), merged into runs rather than one marker per year — a
 * five-year stretch of shortfall reads as one shaded band, not five
 * overlapping slivers. Household-level (any person's shortfall counts),
 * matching the existing "Key flags"/table ⚠ convention for the same
 * condition. Deliberately scoped to *drawdown* shortfall only, not the
 * related-but-distinct living-expenses shortfall (SPEC.md §5.1 step 7) —
 * the two are already visually distinguished elsewhere (the table's own
 * separate ⚠ columns), and conflating them here would blur what the
 * shading is actually telling you.
 */
function computeShortfallRanges(result: ProjectionResult): readonly ShortfallRange[] {
  const ranges: ShortfallRange[] = [];
  let start: string | null = null;
  let end: string | null = null;
  for (const row of result.rows) {
    const isShortfall = row.perPerson.some((p) => p.drawdownShortfall);
    if (isShortfall) {
      start ??= row.taxYear;
      end = row.taxYear;
    } else if (start !== null && end !== null) {
      ranges.push({ start, end });
      start = null;
      end = null;
    }
  }
  if (start !== null && end !== null) ranges.push({ start, end });
  return ranges;
}

/**
 * The main-area results pane (SPEC.md §4 journey 2, §7): a minimal
 * net-worth chart and a year-by-year table, all figures in today's
 * money (real terms, SPEC.md §5.8/§7) since that's the engine's native
 * unit. Lives alongside the input sidebar (Onboarding.tsx's AppShell)
 * so edits are reflected here immediately, with no separate "submit"
 * step — `scenario` is null only when required inputs (a date of
 * birth) haven't been filled in yet.
 */
export function ProjectionResults({ scenario }: { readonly scenario: Scenario | null }) {
  const navigate = useNavigate();
  // A view preference, not part of the financial plan — kept as local
  // component state rather than on the Scenario, and starts with just
  // "Net worth" selected so the chart looks the same as before this line
  // picker existed.
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["netWorth"]);

  const result = useMemo(() => (scenario ? computeProjection(scenario) : null), [scenario]);
  const keyFlags = useMemo(() => computeKeyFlags(result, scenario), [result, scenario]);
  const chartEvents = useMemo(() => (scenario && result ? buildChartEvents(scenario, result) : []), [scenario, result]);
  const shortfallRanges = useMemo(() => (result ? computeShortfallRanges(result) : []), [result]);
  const accountMetrics = useMemo(() => (scenario ? buildAccountMetrics(scenario) : []), [scenario]);
  const allMetrics = useMemo(() => [...CHART_METRICS, ...accountMetrics], [accountMetrics]);
  const balanceMetrics = useMemo(
    () => accountMetrics.filter((m) => m.accountKind === "pension" || m.accountKind === "isa" || m.accountKind === "gia" || m.accountKind === "cash"),
    [accountMetrics],
  );
  // Split the same way the taxable/non-taxable drawdown preference does
  // (`drawdown/solveDrawdown.ts`'s `taxablePreferenceAmount`): pension is
  // the one taxable account kind, ISA/GIA/cash the non-taxable ones — so
  // a balance column reuses the exact same colour as the income columns
  // it corresponds to, rather than a third, unrelated colour scheme.
  const pensionBalanceMetrics = useMemo(() => balanceMetrics.filter((m) => m.accountKind === "pension"), [balanceMetrics]);
  const nonTaxableBalanceMetrics = useMemo(() => balanceMetrics.filter((m) => m.accountKind !== "pension"), [balanceMetrics]);
  // Only columns for income sources/drains actually present in the
  // scenario — a column of nothing but zeroes for a catalog type the
  // user never added is noise, not information. Groups left with no
  // visible columns at all (e.g. no taxable income of any kind) drop out
  // entirely too, rather than showing an empty coloured header for nothing.
  const visibleColumnGroups = useMemo(
    () =>
      scenario
        ? TABLE_COLUMN_GROUPS.map((group) => ({
            ...group,
            columns: group.columns.filter((c) => (c.isIncluded ? c.isIncluded(scenario) : true)),
          })).filter((group) => group.columns.length > 0)
        : [],
    [scenario],
  );

  // Seeds the chart with each pension/ISA/GIA/cash balance line the first
  // time its own account appears — knowing how each pot tracks over time
  // is important enough to show without an extra click. `ProjectionResults`
  // is a long-lived component that never remounts as accounts are added
  // (Onboarding.tsx just passes it an updated `scenario` prop each edit,
  // typically well after this component's first mount, before a date of
  // birth is even filled in) — so a `useState` initializer alone can only
  // ever see whatever existed at that first instant, never accounts added
  // afterward. Tracks every key already seen (not just "seeded at all
  // once") so a *second* account added later still gets its own default
  // line — the earlier one-shot-flag version of this effect only ever
  // caught the very first account, since it marked itself done before
  // any of the rest existed. Only ever adds newly-appeared keys, never
  // re-adds one the user has since deselected.
  const seenBalanceMetricKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newKeys = balanceMetrics.map((m) => m.key).filter((key) => !seenBalanceMetricKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    for (const key of newKeys) seenBalanceMetricKeysRef.current.add(key);
    setSelectedMetrics((prev) => [...new Set([...prev, ...newKeys])]);
  }, [balanceMetrics]);
  // Recharts renders plain SVG and doesn't pick up Mantine's colour scheme on
  // its own — without this, axis/grid colours stay locked to a light-mode
  // palette and become close to unreadable against a dark background.
  const colorScheme = useComputedColorScheme("light");

  if (!scenario || !result) {
    return (
      <Center h="100%" mih={400}>
        <Text c="dimmed">Add your date of birth to see your projection.</Text>
      </Center>
    );
  }

  const isDark = colorScheme === "dark";
  const chartTextColor = isDark ? "#C1C2C5" : "#495057";
  const chartGridColor = isDark ? "#373A40" : "#e9ecef";
  const chartData = result.rows.map((row) => ({
    taxYear: row.taxYear,
    ...Object.fromEntries(allMetrics.map((m) => [m.key, m.compute(row)])),
  }));
  const visibleMetrics = allMetrics.filter((m) => selectedMetrics.includes(m.key));

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <Title order={2}>Your projection</Title>
        <Group gap="xs">
          <Button variant="subtle" onClick={() => downloadCsv(projectionToCsv(result))}>
            Export report
          </Button>
          <Button variant="subtle" onClick={() => void navigate("/tax-breakdown")}>
            Tax breakdown
          </Button>
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Illustrative projection only, not financial advice — figures are in today&rsquo;s money.
      </Alert>

      {keyFlags.length > 0 && (
        <Alert color="orange" variant="light" title="Key flags">
          <Stack gap={4}>
            {keyFlags.map((flag) => (
              <Text size="sm" key={flag.message}>
                <Text span fw={600}>
                  {flag.taxYear}:
                </Text>{" "}
                {flag.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      <MultiSelect
        label="Lines to show"
        data={[
          { group: "Summary", items: CHART_METRICS.map((m) => ({ value: m.key, label: m.label })) },
          ...(accountMetrics.length > 0
            ? [{ group: "Account balances", items: accountMetrics.map((m) => ({ value: m.key, label: m.label })) }]
            : []),
        ]}
        value={selectedMetrics}
        onChange={setSelectedMetrics}
        maw={480}
      />

      {(chartEvents.length > 0 || shortfallRanges.length > 0) && (
        <Text size="xs" c="dimmed">
          {chartEvents.length > 0 && "Dashed lines mark one-off events and when drawdown starts. "}
          {shortfallRanges.length > 0 && "Shaded red bands mark years a drawdown target isn't fully met."}
        </Text>
      )}

      <div style={{ height: 300 }}>
        {visibleMetrics.length === 0 ? (
          <Center h="100%">
            <Text c="dimmed">Select at least one line above to show a chart.</Text>
          </Center>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 24, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
              {shortfallRanges.map((r) => (
                <ReferenceArea key={`shortfall:${r.start}`} x1={r.start} x2={r.end} fill="#e03131" fillOpacity={0.1} ifOverflow="extendDomain" />
              ))}
              <XAxis
                dataKey="taxYear"
                tickFormatter={(v: string) => v.split("-")[0] ?? v}
                tick={{ fill: chartTextColor }}
                stroke={chartGridColor}
              />
              <YAxis
                width={90}
                tickFormatter={(v: number) => `£${v.toLocaleString()}`}
                tick={{ fill: chartTextColor }}
                stroke={chartGridColor}
              />
              <Tooltip
                formatter={(v: number) => `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                contentStyle={{ backgroundColor: isDark ? "#25262B" : "#fff", borderColor: chartGridColor, color: chartTextColor }}
              />
              <Legend wrapperStyle={{ color: chartTextColor }} />
              {visibleMetrics.map((m) => (
                <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} />
              ))}
              {chartEvents.map((e) => (
                <ReferenceLine
                  key={e.key}
                  x={e.taxYear}
                  stroke={e.color}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{ value: e.label, position: "top", fill: e.color, fontSize: 10 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <Group gap={4}>
        <Title order={4}>Year by year</Title>
        <InfoTip>
          Account balances on the left, then everything that came in this year under &ldquo;Income&rdquo; — taxable
          sources in teal, non-taxable in cyan, matching the balance columns. Pension withdrawals split into their
          own tax-free and taxable shares, with the drawdown net total and combined net income (yellow) at the far
          right of that section. Then outgoings, tax, and net worth.
        </InfoTip>
      </Group>
      <Text size="sm" c="dimmed">
        Colour-coded by section — teal for taxable, cyan for non-taxable.
      </Text>
      <div style={{ overflowX: "auto" }}>
        <Table
          striped
          withTableBorder
          withColumnBorders
          style={{ tableLayout: "fixed" }}
          ff="monospace"
          miw={TABLE_COLUMN_WIDTH * (1 + visibleColumnGroups.reduce((n, g) => n + g.columns.length, 0) + 1 + balanceMetrics.length)}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2}>
                Tax year
              </Table.Th>
              {pensionBalanceMetrics.length > 0 && (
                <Table.Th colSpan={pensionBalanceMetrics.length} bg="var(--mantine-color-teal-light)" ta="center">
                  Pension balances
                </Table.Th>
              )}
              {nonTaxableBalanceMetrics.length > 0 && (
                <Table.Th colSpan={nonTaxableBalanceMetrics.length} bg="var(--mantine-color-cyan-light)" ta="center">
                  Non-taxable balances
                </Table.Th>
              )}
              {visibleColumnGroups.map((group) => (
                <Table.Th key={group.label} colSpan={group.columns.length} bg={group.bg} ta="center">
                  {group.label}
                </Table.Th>
              ))}
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2} bg="var(--mantine-color-blue-light)">
                Net worth
              </Table.Th>
            </Table.Tr>
            <Table.Tr>
              {pensionBalanceMetrics.map((m) => (
                <Table.Th key={m.key} w={TABLE_COLUMN_WIDTH} bg="var(--mantine-color-teal-light)">
                  {m.label}
                </Table.Th>
              ))}
              {nonTaxableBalanceMetrics.map((m) => (
                <Table.Th key={m.key} w={TABLE_COLUMN_WIDTH} bg="var(--mantine-color-cyan-light)">
                  {m.label}
                </Table.Th>
              ))}
              {visibleColumnGroups.flatMap((group) =>
                group.columns.map((column) => (
                  <Table.Th key={column.key} w={TABLE_COLUMN_WIDTH} bg={column.bg ?? group.bg}>
                    {column.label}
                  </Table.Th>
                )),
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.rows.map((row) => {
              const netWorth = computeNetWorth(row);
              return (
                <Table.Tr key={row.taxYear}>
                  <Table.Td>{row.taxYear}</Table.Td>
                  {pensionBalanceMetrics.map((m) => (
                    <Table.Td key={m.key} bg="var(--mantine-color-teal-light)" ta="right">
                      £{m.compute(row).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Table.Td>
                  ))}
                  {nonTaxableBalanceMetrics.map((m) => (
                    <Table.Td key={m.key} bg="var(--mantine-color-cyan-light)" ta="right">
                      £{m.compute(row).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Table.Td>
                  ))}
                  {visibleColumnGroups.flatMap((group) =>
                    group.columns.map((column) => (
                      <Table.Td key={column.key} bg={column.bg ?? group.bg} ta="right">
                        {formatMoney(column.compute(row))}
                        {column.warningFlag?.(row) ? " ⚠" : ""}
                      </Table.Td>
                    )),
                  )}
                  <Table.Td bg="var(--mantine-color-blue-light)" fw={600} ta="right">
                    {formatMoney(netWorth)}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
