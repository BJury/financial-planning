import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { cashContributionDefinition, type CashContributionConfig } from "./cashContribution.js";

const PERSON_ID = personId("p1");

function makeScenarioState(): ScenarioState {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  const scenario: Scenario = {
    schemaVersion: 1,
    household,
    accounts: [],
    incomeSources: [],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
  return { scenario, accountBalances: new Map() };
}

const yearContext: YearContext = { taxYear: "2026-27", calendarYear: 2026, yearIndex: 0 };

describe("cashContributionDefinition.calculateForYear", () => {
  it("returns the configured contribution amount with taxTreatment 'none'", () => {
    const config: CashContributionConfig = { cashAccountId: "acc1", annualContribution: poundsToPence(5000) };
    const result = cashContributionDefinition.calculateForYear(config, makeScenarioState(), yearContext, PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(5000), taxTreatment: "none" });
  });
});

describe("cashContributionDefinition.validate", () => {
  it("has no issues for a normal contribution", () => {
    const config: CashContributionConfig = { cashAccountId: "acc1", annualContribution: poundsToPence(5000) };
    expect(cashContributionDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative contribution", () => {
    const config: CashContributionConfig = { cashAccountId: "acc1", annualContribution: pence(-1) };
    const issues = cashContributionDefinition.validate(config);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualContribution", tier: "hardBlock" });
  });
});

describe("cashContributionDefinition registry metadata", () => {
  it("declares no tax treatment (funded from already-taxed income)", () => {
    expect(cashContributionDefinition.type).toBe("cashContribution");
    expect(cashContributionDefinition.taxTreatment).toBe("none");
  });
});
