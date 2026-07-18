import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { oneOffInflowDefinition, type OneOffInflowConfig } from "./oneOffInflow.js";

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

describe("oneOffInflowDefinition.isActive", () => {
  const config: OneOffInflowConfig = { amount: poundsToPence(50000), date: "2030-06-15", category: "inheritance" };

  it("is active only in the tax year the date falls in", () => {
    expect(oneOffInflowDefinition.isActive(config, makeScenarioState(), yearContext(2029), PERSON_ID)).toBe(false);
    expect(oneOffInflowDefinition.isActive(config, makeScenarioState(), yearContext(2030), PERSON_ID)).toBe(true);
    expect(oneOffInflowDefinition.isActive(config, makeScenarioState(), yearContext(2031), PERSON_ID)).toBe(false);
  });
});

describe("oneOffInflowDefinition.calculateForYear", () => {
  it("returns the full amount as tax-free, regardless of category", () => {
    for (const category of ["inheritance", "giftReceived", "other"] as const) {
      const config: OneOffInflowConfig = { amount: poundsToPence(10000), date: "2030-01-01", category };
      const result = oneOffInflowDefinition.calculateForYear(config, makeScenarioState(), yearContext(2030), PERSON_ID);
      expect(result).toEqual({ kind: "simple", amount: poundsToPence(10000), taxCategory: "taxFree" });
    }
  });
});

describe("oneOffInflowDefinition.validate", () => {
  it("has no issues for a normal, dated inflow", () => {
    const config: OneOffInflowConfig = { amount: poundsToPence(50000), date: "2030-06-15", category: "inheritance" };
    expect(oneOffInflowDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative amount", () => {
    const config: OneOffInflowConfig = { amount: pence(-100), date: "2030-06-15", category: "other" };
    const issues = oneOffInflowDefinition.validate(config);
    expect(issues.some((i) => i.field === "amount" && i.tier === "hardBlock")).toBe(true);
  });

  it("hard-blocks a missing date", () => {
    const config: OneOffInflowConfig = { amount: poundsToPence(1000), date: "", category: "other" };
    const issues = oneOffInflowDefinition.validate(config);
    expect(issues.some((i) => i.field === "date" && i.tier === "hardBlock")).toBe(true);
  });
});
