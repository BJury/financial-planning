import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { generalCashIncomeDefinition, type GeneralCashIncomeConfig } from "./generalCashIncome.js";

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

describe("generalCashIncomeDefinition.isActive", () => {
  it("is always active — scheduling is handled generically by the instance's own startDate/endDate", () => {
    const config: GeneralCashIncomeConfig = { amount: poundsToPence(5000), destinationAccountId: "cash1" };
    expect(generalCashIncomeDefinition.isActive(config, makeScenarioState(), yearContext(2026), PERSON_ID)).toBe(true);
    expect(generalCashIncomeDefinition.isActive(config, makeScenarioState(), yearContext(2050), "joint")).toBe(true);
  });
});

describe("generalCashIncomeDefinition.calculateForYear", () => {
  it("returns the full amount as tax-free", () => {
    const config: GeneralCashIncomeConfig = { amount: poundsToPence(12000), destinationAccountId: "isa1" };
    const result = generalCashIncomeDefinition.calculateForYear(config, makeScenarioState(), yearContext(2030), PERSON_ID);
    expect(result).toEqual({ kind: "simple", amount: poundsToPence(12000), taxCategory: "taxFree" });
  });
});

describe("generalCashIncomeDefinition.validate", () => {
  it("has no issues for a normal, directed income", () => {
    const config: GeneralCashIncomeConfig = { amount: poundsToPence(5000), destinationAccountId: "cash1" };
    expect(generalCashIncomeDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative amount", () => {
    const config: GeneralCashIncomeConfig = { amount: pence(-100), destinationAccountId: "cash1" };
    const issues = generalCashIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "amount" && i.tier === "hardBlock")).toBe(true);
  });

  it("hard-blocks a missing destination account", () => {
    const config: GeneralCashIncomeConfig = { amount: poundsToPence(1000), destinationAccountId: "" };
    const issues = generalCashIncomeDefinition.validate(config);
    expect(issues.some((i) => i.field === "destinationAccountId" && i.tier === "hardBlock")).toBe(true);
  });
});
