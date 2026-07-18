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
    pensionAccountId: "pension1",
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

  it("is never active for a jointly-owned instance in v1 (household-combined targets are Phase 5)", () => {
    const active = targetDrawdownIncomeDefinition.isActive(baseConfig, makeScenarioState([person]), yearContext(2030), "joint");
    expect(active).toBe(false);
  });
});

describe("targetDrawdownIncomeDefinition.validate", () => {
  it("has no issues for a normal, fully-specified target", () => {
    const config: TargetDrawdownIncomeConfig = {
      targetNetAnnualIncome: poundsToPence(30000),
      startAge: 67,
      pensionAccountId: "pension1",
      isaAccountId: "isa1",
    };
    expect(targetDrawdownIncomeDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative target", () => {
    const config: TargetDrawdownIncomeConfig = { targetNetAnnualIncome: pence(-100), startAge: 67, pensionAccountId: "pension1" };
    const issues = targetDrawdownIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "targetNetAnnualIncome" && i.tier === "hardBlock")).toBe(true);
  });

  it("soft-warns when neither a pension nor an ISA account is selected", () => {
    const config: TargetDrawdownIncomeConfig = { targetNetAnnualIncome: poundsToPence(30000), startAge: 67 };
    const issues = targetDrawdownIncomeDefinition.validate(config);
    expect(issues.some((i) => i.tier === "softWarning")).toBe(true);
  });

  it("hard-blocks an end age that isn't after the start age", () => {
    const config: TargetDrawdownIncomeConfig = {
      targetNetAnnualIncome: poundsToPence(30000),
      startAge: 67,
      endAge: 67,
      pensionAccountId: "pension1",
    };
    const issues = targetDrawdownIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "endAge" && i.tier === "hardBlock")).toBe(true);
  });
});

describe("targetDrawdownIncomeDefinition registry metadata", () => {
  it("is registered under the expected type key", () => {
    expect(targetDrawdownIncomeDefinition.type).toBe("targetDrawdownIncome");
  });
});
