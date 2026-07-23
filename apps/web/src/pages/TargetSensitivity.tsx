import { penceToPounds, poundsToPence, type Scenario, type TargetDrawdownIncomeConfig } from "@fp/engine";
import { Alert, Button, Group, NumberInput, Stack, Switch, Table, Text, Title } from "@mantine/core";
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { AboutDialog } from "../components/AboutDialog.js";
import { ageFromIsoDate } from "../components/AgeOrDateInput.js";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { computeProjection } from "../projection.js";
import {
  ageLabel,
  buildDeltaSteps,
  firstShortfall,
  MAX_COMBINATIONS,
  shortfallCellBackground,
  shortfallIntensity,
} from "../sensitivityGrid.js";
import { useScenarioStore } from "../state/store.js";

function formatMoneyRounded(amountInPounds: number): string {
  return `£${Math.round(amountInPounds).toLocaleString()}`;
}

/**
 * The tax year a person reaches a given age, on the engine's own
 * whole-year-granularity convention (`schema/age.ts`'s `ageAtYear` is a
 * plain `calendarYear - birthYear` subtraction, and `runProjection.ts`
 * builds its own `taxYear` string the identical way) — deliberately not
 * re-run through `computeProjection` just for this, since the mapping
 * from age to tax year depends only on the person's birth year, never on
 * anything the projection itself computes.
 */
function taxYearForAge(dateOfBirth: string, age: number): string {
  const calendarYear = new Date(dateOfBirth).getUTCFullYear() + age;
  return `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
}

/**
 * The earliest-starting `targetDrawdownIncome` phase (there's always at
 * least one on a scenario built via Onboarding, but a hand-edited/imported
 * file could have none) — the baseline this grid's own "0" row/column is
 * shown relative to, the same role `drawdownTargets[0]` plays in
 * `Onboarding.tsx`'s own Quick Start/contribution-default logic.
 */
function firstTargetPhase(scenario: Scenario) {
  return scenario.incomeSources
    .filter((s) => s.type === "targetDrawdownIncome")
    .sort((a, b) => (a.config as TargetDrawdownIncomeConfig).startAge - (b.config as TargetDrawdownIncomeConfig).startAge)[0];
}

/**
 * SPEC.md §9.7's "naive full recompute" is cheap enough (~3ms/run) that
 * re-running the whole projection once per grid cell, entirely on the
 * main thread, is the straightforward choice here — no worker, no
 * incremental caching, matching `StressTest.tsx`'s identical approach.
 */
export function TargetSensitivity() {
  const scenario = useScenarioStore((s) => s.scenario);
  const navigate = useNavigate();

  const baselinePhase = scenario ? firstTargetPhase(scenario) : undefined;
  const baselineConfig = baselinePhase?.config as TargetDrawdownIncomeConfig | undefined;
  // A joint target has no single owner to take an age from — falls back
  // to the first household member, the same "You" convention `ageLabel`
  // already uses elsewhere on this page.
  const targetOwnerPerson =
    scenario && baselinePhase
      ? (scenario.household.people.find((p) => p.id === baselinePhase.owner) ?? scenario.household.people[0])
      : undefined;
  const currentAge = targetOwnerPerson ? ageFromIsoDate(targetOwnerPerson.dateOfBirth, new Date().toISOString().slice(0, 10)) : undefined;
  // The lowest age-delta that doesn't push the resulting retirement age
  // below the person's actual age *today* — a smaller delta would mean
  // "retiring" at an age they've already passed, a date in the past, not
  // a real what-if. `undefined` (no clamp) when there's no DOB yet to
  // measure from.
  const strictMinAgeDelta = currentAge !== undefined && baselineConfig ? currentAge - baselineConfig.startAge : undefined;
  const defaultAgeMin = strictMinAgeDelta !== undefined ? Math.max(-5, strictMinAgeDelta) : -5;

  const [showAge, setShowAge] = useState(false);
  const [ageMin, setAgeMin] = useState(defaultAgeMin);
  const [ageMax, setAgeMax] = useState(5);
  const [ageStep, setAgeStep] = useState(1);
  const [incomeMin, setIncomeMin] = useState(-10000);
  const [incomeMax, setIncomeMax] = useState(10000);
  const [incomeStep, setIncomeStep] = useState(2000);

  const ageDeltas = useMemo(() => buildDeltaSteps(ageMin, ageMax, ageStep), [ageMin, ageMax, ageStep]);
  const incomeDeltas = useMemo(() => buildDeltaSteps(incomeMin, incomeMax, incomeStep), [incomeMin, incomeMax, incomeStep]);
  const totalCombinations = ageDeltas.length * incomeDeltas.length;
  // The Retirement income target section always has at least one phase
  // (`Onboarding.tsx`'s `createDefaultDrawdownTarget`, £0 by default) —
  // checking `baselineConfig` alone would never gate anything, since that
  // default phase always exists. A real target needs a nonzero amount
  // somewhere, matching `ProjectionResults.tsx`'s own `hasActiveDrawdownTarget`.
  const hasActiveTarget = (scenario?.incomeSources ?? []).some(
    (s) => s.type === "targetDrawdownIncome" && (s.config as TargetDrawdownIncomeConfig).targetNetAnnualIncome > 0,
  );

  const grid = useMemo(() => {
    if (!scenario || !baselineConfig || !hasActiveTarget || totalCombinations > MAX_COMBINATIONS) return null;
    return ageDeltas.map((ageDelta) =>
      incomeDeltas.map((incomeDelta) => {
        // Every phase shifts together, by the same amount — preserves any
        // step up/down between phases rather than collapsing them onto
        // each other, and matches how the Stress Test grid shifts every
        // account's growth rate by the same delta rather than picking one.
        const variant: Scenario = {
          ...scenario,
          incomeSources: scenario.incomeSources.map((source) => {
            if (source.type !== "targetDrawdownIncome") return source;
            const config = source.config as TargetDrawdownIncomeConfig;
            return {
              ...source,
              config: {
                ...config,
                startAge: Math.max(1, config.startAge + ageDelta),
                targetNetAnnualIncome: poundsToPence(Math.max(0, penceToPounds(config.targetNetAnnualIncome) + incomeDelta)),
              },
            };
          }),
        };
        return { ageDelta, incomeDelta, shortfall: firstShortfall(computeProjection(variant)) };
      }),
    );
  }, [scenario, baselineConfig, hasActiveTarget, ageDeltas, incomeDeltas, totalCombinations]);

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
        <Title order={2}>Target sensitivity</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" size="xs" onClick={() => void navigate("/stress-test")}>
            Stress test
          </Button>
          <Button variant="subtle" size="xs" onClick={() => void navigate("/")}>
            Back to projection
          </Button>
          <AboutDialog />
          <ColorSchemeToggle />
        </Group>
      </Group>

      {!baselineConfig || !hasActiveTarget ? (
        <Alert color="orange" variant="light">
          Add a Retirement income target on the projection page first — this grid varies its start age and target
          amount, so there's nothing to vary without one.
        </Alert>
      ) : (
        <>
          <Alert color="blue" variant="light">
            Re-runs your plan across a grid of retirement age and target income variations, to see which combinations
            run out of money before the end of the projection. Every phase of your Retirement income target shifts
            together by the same amount — a step up/down between phases stays the same shape, just moved earlier,
            later, higher, or lower. Rows and columns are labelled with the resulting first phase&rsquo;s own start
            age/target, built by shifting your own figures up or down using the ranges below.
          </Alert>

          <Group align="flex-end" gap="xl">
            <Group gap="xs" align="flex-end">
              <Text size="sm" fw={500} w={110}>
                Retirement age
              </Text>
              <NumberInput
                label="Min"
                suffix=" yrs"
                {...(strictMinAgeDelta !== undefined ? { min: strictMinAgeDelta } : {})}
                value={ageMin}
                onChange={(v) => setAgeMin(typeof v === "number" ? v : 0)}
                w={110}
              />
              <NumberInput label="Max" suffix=" yrs" value={ageMax} onChange={(v) => setAgeMax(typeof v === "number" ? v : 0)} w={110} />
              <NumberInput label="Step" suffix=" yrs" min={1} value={ageStep} onChange={(v) => setAgeStep(typeof v === "number" ? v : 1)} w={110} />
            </Group>
            <Group gap="xs" align="flex-end">
              <Text size="sm" fw={500} w={110}>
                Target income
              </Text>
              <NumberInput
                label="Min"
                leftSection="£"
                step={1000}
                value={incomeMin}
                onChange={(v) => setIncomeMin(typeof v === "number" ? v : 0)}
                w={110}
              />
              <NumberInput
                label="Max"
                leftSection="£"
                step={1000}
                value={incomeMax}
                onChange={(v) => setIncomeMax(typeof v === "number" ? v : 0)}
                w={110}
              />
              <NumberInput
                label="Step"
                leftSection="£"
                min={100}
                step={500}
                value={incomeStep}
                onChange={(v) => setIncomeStep(typeof v === "number" ? v : 500)}
                w={110}
              />
            </Group>
          </Group>

          {totalCombinations > MAX_COMBINATIONS ? (
            <Alert color="red" variant="light">
              That range would run {totalCombinations} combinations — more than the {MAX_COMBINATIONS} limit. Narrow
              the range or widen the step.
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
                      <Table.Th>{showAge ? "Retirement age" : "Retirement year"} ↓ / Target income →</Table.Th>
                      {incomeDeltas.map((incomeDelta) => (
                        <Table.Th key={incomeDelta} ta="center">
                          {formatMoneyRounded(penceToPounds(baselineConfig.targetNetAnnualIncome) + incomeDelta)}
                        </Table.Th>
                      ))}
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {grid?.map((row, rowIndex) => {
                      const resultingAge = Math.max(1, baselineConfig.startAge + (ageDeltas[rowIndex] ?? 0));
                      return (
                        <Table.Tr key={ageDeltas[rowIndex]}>
                          <Table.Th>
                            {showAge || !targetOwnerPerson ? resultingAge : taxYearForAge(targetOwnerPerson.dateOfBirth, resultingAge)}
                          </Table.Th>
                          {row.map((cell) => {
                            const isBaseline = cell.ageDelta === 0 && cell.incomeDelta === 0;
                            const bg = cell.shortfall
                              ? shortfallCellBackground(shortfallIntensity(cell.shortfall.yearIndex, shortfallYearIndexRange))
                              : "var(--mantine-color-teal-light)";
                            return (
                              <Table.Td
                                key={cell.incomeDelta}
                                ta="center"
                                bg={bg}
                                style={isBaseline ? { outline: "2px solid var(--mantine-color-blue-6)", outlineOffset: -2 } : undefined}
                              >
                                {cell.shortfall
                                  ? showAge
                                    ? ageLabel(cell.shortfall.calendarYear, scenario.household.people)
                                    : cell.shortfall.taxYear
                                  : "OK"}
                              </Table.Td>
                            );
                          })}
                        </Table.Tr>
                      );
                    })}
                  </Table.Tbody>
                </Table>
              </div>
            </>
          )}

          <Text size="xs" c="dimmed">
            The outlined cell is your plan as it stands today (no change on either axis). A cell shows the first tax
            year — or, with &ldquo;Show age instead of year&rdquo; on, your age(s) that year — a drawdown target or a
            continuous outflow wasn&rsquo;t fully covered, or &ldquo;OK&rdquo; if the plan survives the whole
            projection under that combination — shaded a brighter red the earlier that failure happens, so the worst
            combinations stand out at a glance.
          </Text>
        </>
      )}
    </Stack>
  );
}
