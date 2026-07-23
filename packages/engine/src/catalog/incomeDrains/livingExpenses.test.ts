import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { livingExpensesDefinition, type LivingExpensesConfig } from "./livingExpenses.js";

const PERSON_ID = personId("p1");
const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };

function makeScenarioState(): ScenarioState {
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

describe("livingExpensesDefinition.calculateForYear", () => {
  it("returns the configured annual amount with no tax treatment, regardless of category", () => {
    const config: LivingExpensesConfig = { annualAmount: poundsToPence(24000), category: "educationFees" };
    const result = livingExpensesDefinition.calculateForYear(config, makeScenarioState(), yearContext, PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(24000), taxTreatment: "none" });
  });
});

describe("livingExpensesDefinition.isActive", () => {
  it("is always active (subject to the generic start/end date scheduling every instance has)", () => {
    const config: LivingExpensesConfig = { annualAmount: poundsToPence(24000), category: "livingCosts" };
    expect(livingExpensesDefinition.isActive(config, makeScenarioState(), yearContext, PERSON_ID)).toBe(true);
  });
});

describe("livingExpensesDefinition.validate", () => {
  it("has no issues for a normal amount", () => {
    expect(livingExpensesDefinition.validate({ annualAmount: poundsToPence(24000), category: "livingCosts" })).toEqual([]);
  });

  it("hard-blocks a negative amount", () => {
    const issues = livingExpensesDefinition.validate({ annualAmount: pence(-100), category: "livingCosts" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualAmount", tier: "hardBlock" });
  });
});

describe("livingExpensesDefinition metadata", () => {
  it("is framed as a continuous outflow, and offers a category field alongside the amount", () => {
    expect(livingExpensesDefinition.displayName).toBe("Continuous outflow");
    expect(livingExpensesDefinition.fields.map((f) => f.key)).toEqual(["annualAmount", "category"]);
    const categoryField = livingExpensesDefinition.fields.find((f) => f.key === "category");
    expect(categoryField?.options?.map((o) => o.value)).toEqual(["livingCosts", "educationFees", "careCosts", "debtRepayment", "other"]);
  });
});
