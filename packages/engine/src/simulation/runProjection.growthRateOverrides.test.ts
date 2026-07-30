import { describe, expect, it } from "vitest";
import { poundsToPence, type Pence } from "../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection } from "./runProjection.js";

import "../catalog/incomeSources/salary.js";

const PERSON_ID = personId("p1");

function makeScenario(): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 90 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    household,
    accounts: [
      { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(10000), annualGrowthRate: 0.04 },
      { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: poundsToPence(5000), costBasis: poundsToPence(5000), annualGrowthRate: 0.03, annualDividendYield: 0.02 },
    ],
    incomeSources: [{ id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(40000), annualGrowthRate: 0 } }],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runProjection — growthRateOverrides", () => {
  it("reproduces identical output to omitting the parameter entirely, when the map is empty", () => {
    const withNoParam = runProjection(makeScenario(), ruleSet2026_27, 5);
    const withEmptyMap = runProjection(makeScenario(), ruleSet2026_27, 5, new Map());
    expect(withEmptyMap).toEqual(withNoParam);
  });

  it("overriding one account's growth rate changes only that account's balances, leaving every other account and every tax figure untouched", () => {
    const baseline = runProjection(makeScenario(), ruleSet2026_27, 5);
    const overridden = runProjection(
      makeScenario(),
      ruleSet2026_27,
      5,
      new Map([["isa1", [0.5, 0.5, 0.5, 0.5, 0.5]]]),
    );

    for (let year = 0; year < 5; year++) {
      const baseRow = baseline.rows[year];
      const overriddenRow = overridden.rows[year];
      expect(overriddenRow?.accountBalances.get("isa1")).not.toEqual(baseRow?.accountBalances.get("isa1"));
      expect(overriddenRow?.accountBalances.get("gia1")).toEqual(baseRow?.accountBalances.get("gia1"));
      expect(overriddenRow?.perPerson[0]?.incomeTax).toEqual(baseRow?.perPerson[0]?.incomeTax);
    }
  });

  it("a per-year override array is read by yearIndex, so different years can grow at different rates within the same run", () => {
    const result = runProjection(makeScenario(), ruleSet2026_27, 3, new Map([["isa1", [1.0, 0, 0]]]));
    const year0Balance = result.rows[0]?.accountBalances.get("isa1") as Pence;
    const year1Balance = result.rows[1]?.accountBalances.get("isa1") as Pence;
    const year2Balance = result.rows[2]?.accountBalances.get("isa1") as Pence;
    // Year 0 doubles (rate 1.0), then years 1-2 hold flat (rate 0) since
    // there are no contributions/withdrawals in this scenario.
    expect(year0Balance).toBeGreaterThan(poundsToPence(10000));
    expect(year1Balance).toEqual(year0Balance);
    expect(year2Balance).toEqual(year0Balance);
  });

  it("a missing entry for an account id falls back to that account's own annualGrowthRate", () => {
    const baseline = runProjection(makeScenario(), ruleSet2026_27, 3);
    const overriddenOnlyGia = runProjection(makeScenario(), ruleSet2026_27, 3, new Map([["gia1", [0.9, 0.9, 0.9]]]));
    expect(overriddenOnlyGia.rows[2]?.accountBalances.get("isa1")).toEqual(baseline.rows[2]?.accountBalances.get("isa1"));
  });
});
