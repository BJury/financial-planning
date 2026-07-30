import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, RISK_PROFILE_PRESETS, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runStochasticBatch } from "./runStochasticBatch.js";
import { countUsEquityWindows } from "./sampleReturns.js";

import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";
import "../catalog/incomeDrains/pensionContribution.js";
import "../catalog/incomeDrains/isaContribution.js";
import "../catalog/incomeDrains/livingExpenses.js";

const PERSON_A = personId("a");
const PERSON_B = personId("b");

/**
 * A moderately dense two-person, decumulation-active scenario — not
 * `simulation/performance.test.ts`'s absolute worst case, but complex
 * enough (household drawdown optimiser running, multiple account kinds,
 * multiple asset classes blended) to give a realistic per-run cost for
 * the throughput assumption behind moving stochastic batches to a web
 * worker (see the "Stochastic projections" plan/SPEC.md section).
 */
function moderateScenario(): Scenario {
  return {
    schemaVersion: 1,
    household: {
      people: [
        { id: PERSON_A, dateOfBirth: "1970-01-01", targetRetirementAge: 60, projectionEndAge: 95 },
        { id: PERSON_B, dateOfBirth: "1972-01-01", targetRetirementAge: 60, projectionEndAge: 95 },
      ],
      relationshipStatus: "marriedOrCivilPartnership",
      targetIncomeMode: "combined",
    },
    accounts: [
      {
        kind: "pension",
        id: "pA",
        owner: PERSON_A,
        pensionType: "sipp",
        currentBalance: poundsToPence(400000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: poundsToPence(3000),
        assetAllocation: RISK_PROFILE_PRESETS.balanced,
      },
      {
        kind: "pension",
        id: "pB",
        owner: PERSON_B,
        pensionType: "workplaceDC",
        currentBalance: poundsToPence(350000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: poundsToPence(3000),
        assetAllocation: RISK_PROFILE_PRESETS.cautious,
      },
      { kind: "isa", id: "iA", owner: PERSON_A, isaType: "stocksAndShares", currentBalance: poundsToPence(80000), annualGrowthRate: 0.04, assetAllocation: RISK_PROFILE_PRESETS.adventurous },
      { kind: "isa", id: "iB", owner: PERSON_B, isaType: "stocksAndShares", currentBalance: poundsToPence(60000), annualGrowthRate: 0.04, assetAllocation: RISK_PROFILE_PRESETS.balanced },
      { kind: "gia", id: "g1", owner: "joint", currentBalance: poundsToPence(100000), costBasis: poundsToPence(70000), annualGrowthRate: 0.03, annualDividendYield: 0.03 },
      { kind: "cash", id: "c1", owner: "joint", currentBalance: poundsToPence(30000), annualGrowthRate: 0.03 },
    ],
    incomeSources: [
      { id: "s1", type: "salary", owner: PERSON_A, config: { grossAnnualSalary: poundsToPence(60000), annualGrowthRate: 0.02 }, endDate: "2029-12-31" },
      { id: "s2", type: "salary", owner: PERSON_B, config: { grossAnnualSalary: poundsToPence(55000), annualGrowthRate: 0.02 }, endDate: "2031-12-31" },
      { id: "s3", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 60, householdSplitStrategy: "optimised" } },
    ],
    incomeDrains: [
      { id: "d1", type: "pensionContribution", owner: PERSON_A, config: { pensionAccountId: "pA", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(8000) }, endDate: "2030-01-01" },
      { id: "d2", type: "isaContribution", owner: PERSON_B, config: { isaAccountId: "iB", annualContribution: poundsToPence(10000) }, endDate: "2030-01-01" },
      { id: "d3", type: "livingExpenses", owner: "joint", config: { annualAmount: poundsToPence(30000) } },
    ],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runStochasticBatch performance", () => {
  it("runs a 300-trajectory, 30-year historical-bootstrap batch well within a web-worker-friendly budget", () => {
    const scenario = moderateScenario();
    runStochasticBatch({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 30, method: "historical", runCount: 10, seed: 1 }); // warm up the JIT

    const start = Date.now();
    const result = runStochasticBatch({ scenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 30, method: "historical", runCount: 300, seed: 2 });
    const elapsed = Date.now() - start;

    expect(result.runCount).toBe(300);
    // Generous relative to the ~3ms/run single-projection baseline
    // (`simulation/performance.test.ts`) — a regression guard against a
    // real slowdown in the per-trajectory overhead, not a tight bound.
    expect(elapsed).toBeLessThan(5000);
  });

  it("runs a 30-year exhaustive US-equities backtest (~950 windows, ignoring runCount) well within a web-worker-friendly budget", () => {
    const scenario = moderateScenario();
    const usEquityScenario: Scenario = {
      ...scenario,
      accounts: scenario.accounts.map((a) =>
        a.assetAllocation ? { ...a, assetAllocation: { ...a.assetAllocation, equityMarket: "us" as const } } : a,
      ),
    };
    runStochasticBatch({ scenario: usEquityScenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 30, method: "historical", runCount: 10, seed: 1 }); // warm up the JIT

    const start = Date.now();
    const result = runStochasticBatch({ scenario: usEquityScenario, confirmedRuleSet: ruleSet2026_27, numberOfYears: 30, method: "historical", runCount: 300, seed: 2 });
    const elapsed = Date.now() - start;

    expect(result.runCount).toBe(countUsEquityWindows(30));
    expect(elapsed).toBeLessThan(15000);
  });
});
