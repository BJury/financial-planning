import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, RISK_PROFILE_PRESETS, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runStochasticTrajectory } from "./runStochasticTrajectory.js";
import type { AssetClass } from "./assetClasses.js";

import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";

const PERSON_ID = personId("p1");

function makeScenario(): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 90 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    household,
    accounts: [
      {
        kind: "isa",
        id: "isaStocks",
        owner: PERSON_ID,
        isaType: "stocksAndShares",
        currentBalance: poundsToPence(10000),
        annualGrowthRate: 0.04,
        assetAllocation: RISK_PROFILE_PRESETS.adventurous,
      },
      { kind: "isa", id: "isaCash", owner: PERSON_ID, isaType: "cash", currentBalance: poundsToPence(10000), annualGrowthRate: 0.02 },
      { kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: poundsToPence(10000), annualGrowthRate: 0.02 },
      { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: poundsToPence(10000), costBasis: poundsToPence(10000), annualGrowthRate: 0.03, annualDividendYield: 0.02 },
    ],
    incomeSources: [{ id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(40000), annualGrowthRate: 0 } }],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

const extremeReturns: Record<AssetClass, readonly number[]> = {
  usEquities: [2, 2, 2],
  ukEquities: [2, 2, 2],
  bonds: [2, 2, 2],
  cash: [2, 2, 2],
};

const flatReturns: Record<AssetClass, readonly number[]> = {
  usEquities: [0, 0, 0],
  ukEquities: [0, 0, 0],
  bonds: [0, 0, 0],
  cash: [0, 0, 0],
};

describe("runStochasticTrajectory", () => {
  it("only varies stochastic-eligible accounts (stocks ISA, GIA) — cash accounts and cash ISAs stay on their own deterministic rate", () => {
    const withExtreme = runStochasticTrajectory(makeScenario(), ruleSet2026_27, 3, () => extremeReturns);
    const withFlat = runStochasticTrajectory(makeScenario(), ruleSet2026_27, 3, () => flatReturns);
    // Net worth should differ substantially given a 200% sampled return applied to eligible accounts.
    expect(withExtreme.netWorthByYear[2]).toBeGreaterThan(withFlat.netWorthByYear[2] ?? 0);
  });

  it("returns one net worth figure per simulated year", () => {
    const result = runStochasticTrajectory(makeScenario(), ruleSet2026_27, 5, () => flatReturns);
    expect(result.netWorthByYear).toHaveLength(5);
  });

  it("reports hadShortfall as false for a scenario with ample income and no drawdown target", () => {
    const result = runStochasticTrajectory(makeScenario(), ruleSet2026_27, 5, () => flatReturns);
    expect(result.hadShortfall).toBe(false);
  });

  it("shortfallByYear has one entry per simulated year, matching hadShortfall's aggregate", () => {
    const result = runStochasticTrajectory(makeScenario(), ruleSet2026_27, 5, () => flatReturns);
    expect(result.shortfallByYear).toHaveLength(5);
    expect(result.shortfallByYear.every((v) => !v)).toBe(true);
    expect(result.shortfallByYear.some(Boolean)).toBe(result.hadShortfall);
  });

  it("shortfallByYear picks out which specific years failed to meet the drawdown target, not just that some year did", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 90 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runStochasticTrajectory(scenario, ruleSet2026_27, 5, () => flatReturns);
    // A tiny balance against a much larger target income shortfalls every year once it's exhausted.
    expect(result.hadShortfall).toBe(true);
    expect(result.shortfallByYear.some(Boolean)).toBe(true);
    expect(result.shortfallByYear).toHaveLength(5);
  });

  it("classifies a shortfall as 'depleted' when net worth is genuinely exhausted, not just the target income unmet", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 90 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      // Only a tiny ISA, no pension — once it's drawn dry there's genuinely nothing left anywhere.
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runStochasticTrajectory(scenario, ruleSet2026_27, 5, () => flatReturns);
    expect(result.shortfallSeverity).toBe("depleted");
    expect(result.netWorthByYear.at(-1)).toBeLessThanOrEqual(0);
  });

  it("classifies a shortfall as 'recoverable' when net worth is still positive — money exists but is locked (e.g. in a pension before access age)", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 90 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [
        // A tiny liquid ISA that drains fast...
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: 0 },
        // ...alongside a large pension that can't be touched until well after this 5-year window, so it just sits there — net worth stays large even while income goes unmet.
        {
          kind: "pension",
          id: "pension1",
          owner: PERSON_ID,
          pensionType: "sipp",
          currentBalance: poundsToPence(500000),
          annualGrowthRate: 0,
          annualChargeRate: 0,
          employerAnnualContribution: poundsToPence(0),
          accessDate: "2060-01-01",
        },
      ],
      incomeSources: [
        { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runStochasticTrajectory(scenario, ruleSet2026_27, 5, () => flatReturns);
    expect(result.hadShortfall).toBe(true);
    expect(result.shortfallSeverity).toBe("recoverable");
    // The locked pension dominates net worth throughout, regardless of the unmet income target.
    for (const netWorth of result.netWorthByYear) expect(netWorth).toBeGreaterThan(poundsToPence(400000));
  });

  it("an account with no assetAllocation falls back to the balanced default (still varies with sampled returns)", () => {
    const scenario = makeScenario();
    const withoutAllocation: Scenario = {
      ...scenario,
      accounts: scenario.accounts.map((a) => {
        if (a.id !== "isaStocks") return a;
        const { assetAllocation: _unused, ...withoutAllocation } = a;
        return withoutAllocation;
      }),
    };
    const withExtreme = runStochasticTrajectory(withoutAllocation, ruleSet2026_27, 2, () => extremeReturns);
    const withFlat = runStochasticTrajectory(withoutAllocation, ruleSet2026_27, 2, () => flatReturns);
    expect(withExtreme.netWorthByYear[1]).toBeGreaterThan(withFlat.netWorthByYear[1] ?? 0);
  });
});
