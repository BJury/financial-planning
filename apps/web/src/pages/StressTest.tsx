import { ageAtYear, type Person, type ProjectionResult, type Scenario } from "@fp/engine";
import { Alert, Button, Group, NumberInput, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AboutDialog } from "../components/AboutDialog.js";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { computeProjection } from "../projection.js";
import { useScenarioStore } from "../state/store.js";

/** Guards against a runaway grid from an extreme range/step combination — at ~3ms/combination (SPEC.md §9.7), this is comfortably under a second even worst-case. */
const MAX_COMBINATIONS = 400;

/**
 * Every value from `min` to `max` in `step` increments, plus `0` always
 * included — `0` is "no change from your current assumptions," the
 * baseline every other cell is being compared against, and it wouldn't
 * necessarily land exactly on the step grid otherwise (e.g. min −3.5,
 * step 1). Rounded to guard against floating-point drift from repeated
 * addition (e.g. 0.1 + 0.1 + 0.1 !== 0.3).
 */
function buildDeltaSteps(min: number, max: number, step: number): readonly number[] {
  if (step <= 0 || min > max) return [0];
  const values = new Set<number>();
  for (let v = min; v <= max + 1e-9; v += step) {
    values.add(Math.round(v * 1000) / 1000);
  }
  values.add(0);
  return [...values].sort((a, b) => a - b);
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** The mean of every account's own growth rate once shifted by this row's delta — one representative figure for a row header, since accounts can (and often do) carry different base rates. */
function averageGrowthRate(scenario: Scenario, delta: number): number {
  if (scenario.accounts.length === 0) return delta;
  return scenario.accounts.reduce((sum, a) => sum + (a.annualGrowthRate + delta), 0) / scenario.accounts.length;
}

interface Shortfall {
  readonly taxYear: string;
  readonly calendarYear: number;
  /** Position within the projection (0 = the very first year) — used to shade earlier failures more intensely than later ones, not for display. */
  readonly yearIndex: number;
}

/** The first year, if any, where any household member's drawdown target or living expenses weren't fully covered — the same two signals `ProjectionResults.tsx`'s "Key flags"/shortfall shading already use for identical purpose. */
function firstShortfall(result: ProjectionResult): Shortfall | null {
  for (let yearIndex = 0; yearIndex < result.rows.length; yearIndex++) {
    const row = result.rows[yearIndex];
    if (row?.perPerson.some((p) => p.drawdownShortfall || p.livingExpensesShortfall)) {
      return { taxYear: row.taxYear, calendarYear: row.calendarYear, yearIndex };
    }
  }
  return null;
}

/** Each household member's age in the given calendar year — "You 68, Partner 63" once a second person exists, just "68" for one. Doesn't account for survivorship (SPEC.md §5.7.5): a variant scenario's own household composition doesn't change, so there's nothing to drop. */
function ageLabel(calendarYear: number, people: readonly Person[]): string {
  return people.map((p, index) => (people.length > 1 ? `${index === 0 ? "You" : "Partner"} ${ageAtYear(p.dateOfBirth, calendarYear)}` : `${ageAtYear(p.dateOfBirth, calendarYear)}`)).join(", ");
}

/**
 * 1 for the earliest shortfall anywhere in the grid, fading toward 0 as
 * the failure year gets later — a single shortfall value (or none at
 * all) shades at full intensity, since there's nothing to fade relative to.
 */
function shortfallIntensity(yearIndex: number, range: { readonly min: number; readonly max: number } | null): number {
  if (!range || range.max === range.min) return 1;
  return 1 - (yearIndex - range.min) / (range.max - range.min);
}

/**
 * Blends red with the theme's own background colour via `color-mix`
 * rather than picking a fixed Mantine shade, so the gradient stays
 * correctly contrasted in both light and dark mode without a separate
 * palette for each — `--mantine-color-body` already tracks the active
 * colour scheme.
 */
function shortfallCellBackground(intensity: number): string {
  const alphaPercent = Math.round(15 + intensity * 65);
  return `color-mix(in srgb, var(--mantine-color-red-6) ${alphaPercent}%, var(--mantine-color-body))`;
}

/**
 * SPEC.md §9.7's "naive full recompute" is cheap enough (~3ms/run) that
 * re-running the whole projection once per grid cell, entirely on the
 * main thread, is the straightforward choice here — no worker, no
 * incremental caching, matching how `TaxBreakdown.tsx`'s
 * `useHouseholdDrawdownComparison` already re-runs `computeProjection`
 * on a locally modified scenario copy rather than the store.
 */
export function StressTest() {
  const scenario = useScenarioStore((s) => s.scenario);
  const navigate = useNavigate();

  const [showAge, setShowAge] = useState(false);
  const [growthMin, setGrowthMin] = useState(-4);
  const [growthMax, setGrowthMax] = useState(4);
  const [growthStep, setGrowthStep] = useState(1);
  const [inflationMin, setInflationMin] = useState(-2);
  const [inflationMax, setInflationMax] = useState(4);
  const [inflationStep, setInflationStep] = useState(1);

  const growthDeltas = useMemo(() => buildDeltaSteps(growthMin / 100, growthMax / 100, growthStep / 100), [growthMin, growthMax, growthStep]);
  const inflationDeltas = useMemo(
    () => buildDeltaSteps(inflationMin / 100, inflationMax / 100, inflationStep / 100),
    [inflationMin, inflationMax, inflationStep],
  );
  const totalCombinations = growthDeltas.length * inflationDeltas.length;

  const grid = useMemo(() => {
    if (!scenario || totalCombinations > MAX_COMBINATIONS) return null;
    return growthDeltas.map((growthDelta) =>
      inflationDeltas.map((inflationDelta) => {
        const variant: Scenario = {
          ...scenario,
          inflationRate: scenario.inflationRate + inflationDelta,
          accounts: scenario.accounts.map((a) => ({ ...a, annualGrowthRate: a.annualGrowthRate + growthDelta })),
        };
        return { growthDelta, inflationDelta, shortfall: firstShortfall(computeProjection(variant)) };
      }),
    );
  }, [scenario, growthDeltas, inflationDeltas]);

  // The earliest/latest shortfall year anywhere in the grid, so each
  // failing cell's colour intensity is relative to the others rather
  // than an arbitrary fixed scale.
  const shortfallYearIndexRange = useMemo(() => {
    if (!grid) return null;
    const indices = grid.flat().flatMap((cell) => (cell.shortfall ? [cell.shortfall.yearIndex] : []));
    return indices.length > 0 ? { min: Math.min(...indices), max: Math.max(...indices) } : null;
  }, [grid]);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack maw={900} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Stress test</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" onClick={() => void navigate("/")}>
            Back to projection
          </Button>
          <AboutDialog />
          <ColorSchemeToggle />
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Re-runs your plan across a grid of growth-rate and inflation-rate variations, to see which combinations run
        out of money before the end of the projection. Rows and columns are labelled with the resulting rate itself
        (the growth-rate row shows the average across your accounts, since they can each carry a different rate),
        built by shifting your own assumptions up or down using the ranges below. Inflation mainly affects mortgage
        debt and non-inflation-linked tax thresholds — for most plans, without a mortgage, the growth-rate axis is
        what actually moves the outcome.
      </Alert>

      <Group align="flex-end" gap="xl">
        <Group gap="xs" align="flex-end">
          <Text size="sm" fw={500} w={110}>
            Growth rate
          </Text>
          <NumberInput label="Min" rightSection="%" decimalScale={1} value={growthMin} onChange={(v) => setGrowthMin(typeof v === "number" ? v : 0)} w={90} />
          <NumberInput label="Max" rightSection="%" decimalScale={1} value={growthMax} onChange={(v) => setGrowthMax(typeof v === "number" ? v : 0)} w={90} />
          <NumberInput
            label="Step"
            rightSection="%"
            decimalScale={1}
            min={0.1}
            value={growthStep}
            onChange={(v) => setGrowthStep(typeof v === "number" ? v : 0.1)}
            w={90}
          />
        </Group>
        <Group gap="xs" align="flex-end">
          <Text size="sm" fw={500} w={110}>
            Inflation rate
          </Text>
          <NumberInput
            label="Min"
            rightSection="%"
            decimalScale={1}
            value={inflationMin}
            onChange={(v) => setInflationMin(typeof v === "number" ? v : 0)}
            w={90}
          />
          <NumberInput
            label="Max"
            rightSection="%"
            decimalScale={1}
            value={inflationMax}
            onChange={(v) => setInflationMax(typeof v === "number" ? v : 0)}
            w={90}
          />
          <NumberInput
            label="Step"
            rightSection="%"
            decimalScale={1}
            min={0.1}
            value={inflationStep}
            onChange={(v) => setInflationStep(typeof v === "number" ? v : 0.1)}
            w={90}
          />
        </Group>
      </Group>

      {totalCombinations > MAX_COMBINATIONS ? (
        <Alert color="red" variant="light">
          That range would run {totalCombinations} combinations — more than the {MAX_COMBINATIONS} limit. Narrow the
          range or widen the step.
        </Alert>
      ) : (
        <>
          <Group justify="flex-end">
            <Switch label="Show age instead of year" checked={showAge} onChange={(e) => setShowAge(e.currentTarget.checked)} />
          </Group>
          <div style={{ overflowX: "auto" }}>
            <Table withTableBorder>
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Growth ↓ / Inflation →</Table.Th>
                  {inflationDeltas.map((inflationDelta) => (
                    <Table.Th key={inflationDelta} ta="center">
                      {formatRate(scenario.inflationRate + inflationDelta)}
                    </Table.Th>
                  ))}
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {grid?.map((row, rowIndex) => (
                  <Table.Tr key={growthDeltas[rowIndex]}>
                    <Table.Th>{formatRate(averageGrowthRate(scenario, growthDeltas[rowIndex] ?? 0))}</Table.Th>
                    {row.map((cell) => {
                      const isBaseline = cell.growthDelta === 0 && cell.inflationDelta === 0;
                      const bg = cell.shortfall
                        ? shortfallCellBackground(shortfallIntensity(cell.shortfall.yearIndex, shortfallYearIndexRange))
                        : "var(--mantine-color-teal-light)";
                      return (
                        <Table.Td
                          key={cell.inflationDelta}
                          ta="center"
                          bg={bg}
                          style={isBaseline ? { outline: "2px solid var(--mantine-color-blue-6)", outlineOffset: -2 } : undefined}
                        >
                          {cell.shortfall ? (showAge ? ageLabel(cell.shortfall.calendarYear, scenario.household.people) : cell.shortfall.taxYear) : "OK"}
                        </Table.Td>
                      );
                    })}
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </div>
        </>
      )}

      <Text size="xs" c="dimmed">
        The outlined cell is your plan as it stands today (no change on either axis). A cell shows the first tax
        year — or, with &ldquo;Show age instead of year&rdquo; on, your age(s) that year — a drawdown target or
        living expenses weren&rsquo;t fully covered, or &ldquo;OK&rdquo; if the plan survives the whole projection
        under that combination — shaded a brighter red the earlier that failure happens, so the worst combinations
        stand out at a glance.
      </Text>
    </Stack>
  );
}
