import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { targetDrawdownIncomeDefinition, type TargetDrawdownIncomeConfig } from "./targetDrawdownIncome.js";

const PERSON_ID = personId("p1");

const person: Person = { id: PERSON_ID, dateOfBirth: "1960-06-15", targetRetirementAge: 67, projectionEndAge: 95 };

function makeScenarioState(people: readonly Person[]): ScenarioState {
  const household: Household = { people, relationshipStatus: null, targetIncomeMode: "perPerson" };
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

function yearContext(calendarYear: number, yearIndex = 0): YearContext {
  return { taxYear: `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`, calendarYear, yearIndex };
}

describe("targetDrawdownIncomeDefinition.isActive", () => {
  const baseConfig: TargetDrawdownIncomeConfig = {
    targetNetAnnualIncome: poundsToPence(30000),
    startAge: 67,
  };

  it("is inactive before the start age", () => {
    // Person born 1960-06-15: turns 67 in calendar year 2027.
    const active = targetDrawdownIncomeDefinition.isActive(baseConfig, makeScenarioState([person]), yearContext(2026), PERSON_ID);
    expect(active).toBe(false);
  });

  it("is active from the start age onward, with no end age", () => {
    const active = targetDrawdownIncomeDefinition.isActive(baseConfig, makeScenarioState([person]), yearContext(2027), PERSON_ID);
    expect(active).toBe(true);
    const stillActive = targetDrawdownIncomeDefinition.isActive(baseConfig, makeScenarioState([person]), yearContext(2050), PERSON_ID);
    expect(stillActive).toBe(true);
  });

  it("stops at the end age when one is set", () => {
    const config: TargetDrawdownIncomeConfig = { ...baseConfig, endAge: 70 };
    // Turns 70 in calendar year 2030.
    expect(targetDrawdownIncomeDefinition.isActive(config, makeScenarioState([person]), yearContext(2029), PERSON_ID)).toBe(true);
    expect(targetDrawdownIncomeDefinition.isActive(config, makeScenarioState([person]), yearContext(2030), PERSON_ID)).toBe(false);
  });

  it("gates a jointly-owned instance on the first household member's age (SPEC.md §5.7.4)", () => {
    const youngerPartner: Person = { id: personId("p2"), dateOfBirth: "1990-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const state = makeScenarioState([person, youngerPartner]);
    // person (household.people[0]) turns 67 in 2027 — the younger partner's own age is irrelevant to this gate.
    expect(targetDrawdownIncomeDefinition.isActive(baseConfig, state, yearContext(2026), "joint")).toBe(false);
    expect(targetDrawdownIncomeDefinition.isActive(baseConfig, state, yearContext(2027), "joint")).toBe(true);
  });
});

describe("targetDrawdownIncomeDefinition.validate", () => {
  it("has no issues for a normal target — accounts are auto-discovered and pooled, never picked in config (SPEC.md §5.7.1)", () => {
    const config: TargetDrawdownIncomeConfig = { targetNetAnnualIncome: poundsToPence(30000), startAge: 67 };
    expect(targetDrawdownIncomeDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative target", () => {
    const config: TargetDrawdownIncomeConfig = { targetNetAnnualIncome: pence(-100), startAge: 67 };
    const issues = targetDrawdownIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "targetNetAnnualIncome" && i.tier === "hardBlock")).toBe(true);
  });

  it("hard-blocks an end age that isn't after the start age", () => {
    const config: TargetDrawdownIncomeConfig = { targetNetAnnualIncome: poundsToPence(30000), startAge: 67, endAge: 67 };
    const issues = targetDrawdownIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "endAge" && i.tier === "hardBlock")).toBe(true);
  });
});

describe("targetDrawdownIncomeDefinition registry metadata", () => {
  it("is registered under the expected type key", () => {
    expect(targetDrawdownIncomeDefinition.type).toBe("targetDrawdownIncome");
  });
});
