import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { oneOffOutflowDefinition, type OneOffOutflowConfig } from "./oneOffOutflow.js";

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

function yearContext(calendarYear: number): YearContext {
  return { taxYear: `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`, calendarYear, yearIndex: calendarYear - 2026 };
}

describe("oneOffOutflowDefinition.isActive", () => {
  const config: OneOffOutflowConfig = { amount: poundsToPence(30000), date: "2028-03-01", category: "housingDeposit" };

  it("is active only in the tax year the date falls in", () => {
    expect(oneOffOutflowDefinition.isActive(config, makeScenarioState(), yearContext(2027), PERSON_ID)).toBe(false);
    expect(oneOffOutflowDefinition.isActive(config, makeScenarioState(), yearContext(2028), PERSON_ID)).toBe(true);
    expect(oneOffOutflowDefinition.isActive(config, makeScenarioState(), yearContext(2029), PERSON_ID)).toBe(false);
  });

  it("is never active with the date left at its default empty string — see the identical regression test on oneOffInflow", () => {
    const undatedConfig: OneOffOutflowConfig = { amount: poundsToPence(5000), date: "", category: "other" };
    expect(oneOffOutflowDefinition.isActive(undatedConfig, makeScenarioState(), yearContext(2026), PERSON_ID)).toBe(false);
    expect(oneOffOutflowDefinition.isActive(undatedConfig, makeScenarioState(), yearContext(2050), PERSON_ID)).toBe(false);
  });
});

describe("oneOffOutflowDefinition.calculateForYear", () => {
  it("returns the full amount with no tax treatment, regardless of category", () => {
    for (const category of ["housingDeposit", "giftGiven", "weddingCost", "other"] as const) {
      const config: OneOffOutflowConfig = { amount: poundsToPence(5000), date: "2028-01-01", category };
      const result = oneOffOutflowDefinition.calculateForYear(config, makeScenarioState(), yearContext(2028), PERSON_ID);
      expect(result).toEqual({ amount: poundsToPence(5000), taxTreatment: "none" });
    }
  });
});

describe("oneOffOutflowDefinition.validate", () => {
  it("has no issues for a normal, dated outflow", () => {
    const config: OneOffOutflowConfig = { amount: poundsToPence(30000), date: "2028-03-01", category: "housingDeposit" };
    expect(oneOffOutflowDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative amount", () => {
    const config: OneOffOutflowConfig = { amount: pence(-100), date: "2028-03-01", category: "other" };
    const issues = oneOffOutflowDefinition.validate(config);
    expect(issues.some((i) => i.field === "amount" && i.tier === "hardBlock")).toBe(true);
  });
});
