import { describe, expect, it } from "vitest";
import { poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { statePensionDefinition, type StatePensionConfig } from "./statePension.js";

const PERSON_ID = personId("p1");

function makeScenarioState(person: Person): ScenarioState {
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

function yearContext(calendarYear: number, yearIndex: number): YearContext {
  return { taxYear: `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`, calendarYear, yearIndex };
}

describe("statePensionDefinition.calculateForYear", () => {
  it("returns the configured forecast amount verbatim, tagged as statePensionIncome", () => {
    const config: StatePensionConfig = { annualForecastAmount: poundsToPence(11500) };
    const person: Person = { id: PERSON_ID, dateOfBirth: "1958-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 66 };
    const state = makeScenarioState(person);
    const result = statePensionDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ kind: "simple", amount: poundsToPence(11500), taxCategory: "statePensionIncome" });
  });
});

describe("statePensionDefinition.isActive", () => {
  const config: StatePensionConfig = { annualForecastAmount: poundsToPence(11500) };

  it("is inactive before the person's own State Pension Age", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1962-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 66 };
    const state = makeScenarioState(person);
    expect(statePensionDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(false); // age 64
  });

  it("is active from the person's own State Pension Age onward", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1960-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 66 };
    const state = makeScenarioState(person);
    expect(statePensionDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(true); // age 66
  });

  it("falls back to DEFAULT_STATE_PENSION_AGE (67) when statePensionAge isn't set", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1959-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
    const state = makeScenarioState(person);
    expect(statePensionDefinition.isActive(config, state, yearContext(2025, 0), PERSON_ID)).toBe(false); // age 66
    expect(statePensionDefinition.isActive(config, state, yearContext(2026, 1), PERSON_ID)).toBe(true); // age 67
  });

  it("is inactive if the owning person can't be found", () => {
    const state = makeScenarioState({ id: PERSON_ID, dateOfBirth: "1950-01-01", targetRetirementAge: 67, projectionEndAge: 95 });
    expect(statePensionDefinition.isActive(config, state, yearContext(2026, 0), personId("someone-else"))).toBe(false);
  });
});

describe("statePensionDefinition.validate", () => {
  it("hard-blocks a negative forecast amount", () => {
    const issues = statePensionDefinition.validate({ annualForecastAmount: poundsToPence(-100) });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualForecastAmount", tier: "hardBlock" });
  });

  it("has no issues for a zero or positive forecast amount", () => {
    expect(statePensionDefinition.validate({ annualForecastAmount: poundsToPence(0) })).toEqual([]);
    expect(statePensionDefinition.validate({ annualForecastAmount: poundsToPence(11500) })).toEqual([]);
  });
});

describe("statePensionDefinition registry metadata", () => {
  it("declares the required taxCategory and a stable type key", () => {
    expect(statePensionDefinition.type).toBe("statePension");
    expect(statePensionDefinition.taxCategory).toBe("statePensionIncome");
  });
});
