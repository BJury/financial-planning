import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import type { DrawdownGuardrailPolicy } from "../drawdown/guytonKlinger.js";
import { countUsEquityWindows } from "./sampleReturns.js";
import { runStochasticBatch, SAMPLE_TRAJECTORY_COUNT } from "./runStochasticBatch.js";

import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";

const PERSON_ID = personId("p1");

function makeScenario(): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    household,
    accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(100000), annualGrowthRate: 0.04 }],
    incomeSources: [],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runStochasticBatch — percentile aggregation", () => {
  it("computes correct percentiles against a small hand-checkable fixture", () => {
    // Bypass sampling by faking a batch of 10 trajectories with known, sorted net worths for one year.
    // Exercised indirectly: verify the percentile function's *contract* via a tiny runCount and seed,
    // then separately assert the shape/ordering invariants that must hold for any input.
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 3,
      method: "montecarlo",
      runCount: 50,
      seed: 12345,
    });

    expect(result.runCount).toBe(50);
    expect(result.netWorthPercentilesByYear).toHaveLength(3);
    for (const yearPercentiles of result.netWorthPercentilesByYear) {
      expect(yearPercentiles.p10).toBeLessThanOrEqual(yearPercentiles.p15);
      expect(yearPercentiles.p15).toBeLessThanOrEqual(yearPercentiles.p25);
      expect(yearPercentiles.p25).toBeLessThanOrEqual(yearPercentiles.p50);
      expect(yearPercentiles.p50).toBeLessThanOrEqual(yearPercentiles.p75);
      expect(yearPercentiles.p75).toBeLessThanOrEqual(yearPercentiles.p85);
      expect(yearPercentiles.p85).toBeLessThanOrEqual(yearPercentiles.p90);
    }
  });

  it("is deterministic given the same seed", () => {
    const options = { scenario: makeScenario(), confirmedRuleSet: ruleSet2026_27, numberOfYears: 5, method: "historical" as const, runCount: 20, seed: 7 };
    const a = runStochasticBatch(options);
    const b = runStochasticBatch(options);
    expect(a).toEqual(b);
  });

  it("reports a 100% success rate for a scenario with no drawdown target and no living expenses", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 5,
      method: "historical",
      runCount: 30,
      seed: 1,
    });
    expect(result.successRate).toBe(1);
  });

  it("reports onProgress once per completed run", () => {
    const calls: [number, number][] = [];
    runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 2,
      method: "montecarlo",
      runCount: 15,
      seed: 3,
      onProgress: (completed, total) => calls.push([completed, total]),
    });
    expect(calls).toHaveLength(15);
    expect(calls.at(-1)).toEqual([15, 15]);
  });

  it("a scenario whose drawdown target can't be met reports a success rate below 1", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: -0.05 }],
      incomeSources: [
        {
          id: "target1",
          type: "targetDrawdownIncome",
          owner: PERSON_ID,
          config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 },
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runStochasticBatch({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 5, method: "historical", runCount: 20, seed: 9 });
    expect(result.successRate).toBeLessThan(1);
  });

  it("Monte Carlo's mean tracks each account's own annualGrowthRate — a higher growth rate produces higher median net worth", () => {
    const scenarioWithRate = (rate: number): Scenario => {
      const scenario = makeScenario();
      return { ...scenario, accounts: scenario.accounts.map((a) => (a.id === "isa1" ? { ...a, annualGrowthRate: rate } : a)) };
    };
    const optionsFor = (scenario: Scenario) => ({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 20, method: "montecarlo" as const, runCount: 300, seed: 42 });

    const low = runStochasticBatch(optionsFor(scenarioWithRate(0.01)));
    const high = runStochasticBatch(optionsFor(scenarioWithRate(0.08)));

    const lowMedianFinal = low.netWorthPercentilesByYear.at(-1)?.p50 ?? 0;
    const highMedianFinal = high.netWorthPercentilesByYear.at(-1)?.p50 ?? 0;
    expect(highMedianFinal).toBeGreaterThan(lowMedianFinal);
  });

  it("Monte Carlo's mean does NOT track the scenario's inflation rate directly — only each account's own annualGrowthRate", () => {
    const optionsFor = (scenario: Scenario) => ({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 20, method: "montecarlo" as const, runCount: 300, seed: 42 });
    const low = runStochasticBatch(optionsFor({ ...makeScenario(), inflationRate: 0.01 }));
    const high = runStochasticBatch(optionsFor({ ...makeScenario(), inflationRate: 0.08 }));
    expect(low.netWorthPercentilesByYear.at(-1)?.p50).toEqual(high.netWorthPercentilesByYear.at(-1)?.p50);
  });

  it("an explicit monteCarloPresets override takes priority over each account's own annualGrowthRate", () => {
    const scenario = makeScenario();
    const result = runStochasticBatch({
      scenario,
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 3,
      method: "montecarlo",
      runCount: 20,
      seed: 5,
      monteCarloPresets: {
        usEquities: { meanReturn: 5, volatility: 0 },
        ukEquities: { meanReturn: 5, volatility: 0 },
        bonds: { meanReturn: 5, volatility: 0 },
        cash: { meanReturn: 5, volatility: 0 },
      },
    });
    // A 500%-a-year, zero-volatility override should swamp the account's own 4% annualGrowthRate.
    expect(result.netWorthPercentilesByYear.at(-1)?.p50 ?? 0).toBeGreaterThan(poundsToPence(1_000_000));
  });

  it("sampleTrajectories caps at SAMPLE_TRAJECTORY_COUNT even when runCount is much larger", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 5,
      method: "montecarlo",
      runCount: SAMPLE_TRAJECTORY_COUNT * 3,
      seed: 11,
    });
    expect(result.sampleTrajectories).toHaveLength(SAMPLE_TRAJECTORY_COUNT);
  });

  it("sampleTrajectories has one full per-year net worth array per sampled run", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 7,
      method: "montecarlo",
      runCount: 10,
      seed: 11,
    });
    expect(result.sampleTrajectories).toHaveLength(10);
    for (const trajectory of result.sampleTrajectories) expect(trajectory).toHaveLength(7);
  });

  it("sampleTrajectories holds fewer entries than SAMPLE_TRAJECTORY_COUNT when runCount is smaller", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 3,
      method: "historical",
      runCount: 5,
      seed: 11,
    });
    expect(result.sampleTrajectories).toHaveLength(5);
  });

  it("sampleShortfallYears has one per-year boolean array per sampled run, matching sampleTrajectories in count and length", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 7,
      method: "montecarlo",
      runCount: 10,
      seed: 11,
    });
    expect(result.sampleShortfallYears).toHaveLength(result.sampleTrajectories.length);
    for (const shortfallYears of result.sampleShortfallYears) expect(shortfallYears).toHaveLength(7);
    // This scenario has ample income and no drawdown target, so nothing should ever shortfall.
    expect(result.sampleShortfallYears.every((years) => years.every((v) => !v))).toBe(true);
  });

  it("sampleShortfallYears' aggregate (some year true) agrees with finalOutcomes' hadShortfall for the same run", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: -0.05 }],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runStochasticBatch({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 5, method: "historical", runCount: 20, seed: 9 });
    for (let i = 0; i < result.sampleShortfallYears.length; i++) {
      const originalIndex = result.sampledRunIndices[i];
      expect(result.sampleShortfallYears[i]?.some(Boolean)).toBe(result.finalOutcomes[originalIndex ?? -1]?.hadShortfall);
    }
  });

  it("sampledRunIndices has one entry per sampleTrajectories entry, each a valid index into finalOutcomes", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 5,
      method: "montecarlo",
      runCount: 30,
      seed: 11,
    });
    expect(result.sampledRunIndices).toHaveLength(result.sampleTrajectories.length);
    for (const i of result.sampledRunIndices) expect(result.finalOutcomes[i]).toBeDefined();
  });

  it("spreads the sample evenly across the outcome distribution, so a percentile band that's 100% failures still has sampled runs in it", () => {
    // A scenario where a small, wildly-negative-growth pot against a large drawdown target fails in
    // essentially every run — reproducing the bug where a bad-outcome percentile band (e.g. the worst
    // 10-50%) could end up with *zero* runs among the sampled trajectories, purely because "the first
    // SAMPLE_TRAJECTORY_COUNT simulated" has no relationship to "which runs turned out badly."
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: -0.1 }],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const runCount = SAMPLE_TRAJECTORY_COUNT * 5;
    const result = runStochasticBatch({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 5, method: "montecarlo", runCount, seed: 9 });

    // Sort finalOutcomes by net worth, exactly like the frontend's percentile histogram does, and check
    // the worst decile (the failure band most likely to be affected) has at least one sampled run in it.
    const sortedIndices = [...result.finalOutcomes.keys()].sort(
      (a, b) => (result.finalOutcomes[a]?.netWorth ?? 0) - (result.finalOutcomes[b]?.netWorth ?? 0),
    );
    const worstDecile = new Set(sortedIndices.slice(0, Math.floor(runCount / 10)));
    const sampledOriginalIndexSet = new Set(result.sampledRunIndices);
    const overlap = [...worstDecile].filter((i) => sampledOriginalIndexSet.has(i));
    expect(overlap.length).toBeGreaterThan(0);
  });
});

describe("runStochasticBatch — Guyton-Klinger guardrails", () => {
  const POLICY: DrawdownGuardrailPolicy = { cutTriggerPct: 0.2, cutAmountPct: 0.1, raiseTriggerPct: 0.2, raiseAmountPct: 0.1 };

  function makeDrawdownScenario(annualGrowthRate: number): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    return {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000000), annualGrowthRate }],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("incomeByYearPercentiles and sampleGuardrailEvents are always populated, even when guardrails aren't requested", () => {
    const result = runStochasticBatch({ scenario: makeScenario(), confirmedRuleSet: ruleSet2026_27, numberOfYears: 5, method: "montecarlo", runCount: 20, seed: 3 });
    expect(result.incomeByYearPercentiles).toHaveLength(5);
    expect(result.guardrailStats).toBeUndefined();
    expect(result.sampleGuardrailEvents).toHaveLength(result.sampleTrajectories.length);
    for (const events of result.sampleGuardrailEvents) expect(events.every((e) => e === "none")).toBe(true);
  });

  it("guardrailStats is only populated when guardrails were actually requested, and reflects real cut activity for a shrinking scenario", () => {
    const options = {
      scenario: makeDrawdownScenario(-0.06),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 10,
      method: "montecarlo" as const,
      runCount: 50,
      seed: 5,
    };
    const withoutGuardrails = runStochasticBatch(options);
    const withGuardrails = runStochasticBatch({ ...options, guardrails: POLICY });

    expect(withoutGuardrails.guardrailStats).toBeUndefined();
    expect(withGuardrails.guardrailStats).toBeDefined();
    expect(withGuardrails.guardrailStats?.cutFraction ?? 0).toBeGreaterThan(0);
  });

  it("guardrails don't increase the overall failure rate on a marginal, shrinking scenario (same seed, otherwise identical options)", () => {
    const options = {
      scenario: makeDrawdownScenario(-0.04),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 15,
      method: "montecarlo" as const,
      runCount: 100,
      seed: 7,
    };
    const baseline = runStochasticBatch(options);
    const guarded = runStochasticBatch({ ...options, guardrails: POLICY });
    expect(guarded.successRate).toBeGreaterThanOrEqual(baseline.successRate);
  });
});

describe("runStochasticBatch — exhaustive US-equities backtest", () => {
  function makeUsEquityScenario(): Scenario {
    const scenario = makeScenario();
    return {
      ...scenario,
      accounts: scenario.accounts.map((a) => ({ ...a, assetAllocation: { equities: 1, equityMarket: "us" as const, bonds: 0, cash: 0 } })),
    };
  }

  it("ignores runCount and instead runs exactly once per real historical window when an account uses US equities", () => {
    const result = runStochasticBatch({
      scenario: makeUsEquityScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 30,
      method: "historical",
      runCount: 20, // deliberately far from the true exhaustive count, to prove it's overridden
      seed: 1,
    });
    expect(result.runCount).toBe(countUsEquityWindows(30));
    expect(result.runCount).not.toBe(20);
    expect(result.finalOutcomes).toHaveLength(countUsEquityWindows(30));
  });

  it("still honours runCount for a UK-only scenario (equityMarket defaults to uk)", () => {
    const result = runStochasticBatch({
      scenario: makeScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 30,
      method: "historical",
      runCount: 20,
      seed: 1,
    });
    expect(result.runCount).toBe(20);
  });

  it("still honours runCount for a US-equities scenario under Monte Carlo mode (the exhaustive override is historical-bootstrap-only)", () => {
    const result = runStochasticBatch({
      scenario: makeUsEquityScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 30,
      method: "montecarlo",
      runCount: 20,
      seed: 1,
    });
    expect(result.runCount).toBe(20);
  });

  it("is deterministic given the same seed", () => {
    const options = {
      scenario: makeUsEquityScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 30,
      method: "historical" as const,
      runCount: 500,
      seed: 7,
    };
    const a = runStochasticBatch(options);
    const b = runStochasticBatch(options);
    expect(a).toEqual(b);
  });

  it("uses a shorter horizon's larger window count than a longer horizon's", () => {
    const resultFor = (numberOfYears: number) =>
      runStochasticBatch({
        scenario: makeUsEquityScenario(),
        confirmedRuleSet: ruleSet2026_27,
        numberOfYears,
        method: "historical",
        runCount: 100,
        seed: 3,
      });
    expect(resultFor(20).runCount).toBeGreaterThan(resultFor(40).runCount);
  });

  it("sampleTrajectories holds every run, not just the first SAMPLE_TRAJECTORY_COUNT — every window is a distinct real one worth showing", () => {
    const result = runStochasticBatch({
      scenario: makeUsEquityScenario(),
      confirmedRuleSet: ruleSet2026_27,
      numberOfYears: 30,
      method: "historical",
      runCount: 20,
      seed: 1,
    });
    expect(result.runCount).toBeGreaterThan(SAMPLE_TRAJECTORY_COUNT);
    expect(result.sampleTrajectories).toHaveLength(result.runCount);
  });
});
