import { describe, expect, it } from "vitest";
import { poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Property, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { rentalIncomeDefinition, type RentalIncomeConfig } from "./rentalIncome.js";

const PERSON_ID = personId("p1");
const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };

const rentalProperty: Property = {
  id: "prop1",
  kind: "property",
  owner: PERSON_ID,
  propertyType: "rental",
  currentBalance: poundsToPence(250_000),
  annualGrowthRate: 0.01,
  purchasePrice: poundsToPence(200_000),
  purchaseDate: "2015-01-01",
  rentalDetails: { grossAnnualRentalIncome: poundsToPence(12_000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0.01 },
};

function makeScenarioState(accounts: Scenario["accounts"]): ScenarioState {
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  const scenario: Scenario = {
    schemaVersion: 1,
    household,
    accounts,
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

describe("rentalIncomeDefinition.calculateForYear", () => {
  it("deducts actual letting costs as a best-effort placeholder (the real computation is in runProjection)", () => {
    const config: RentalIncomeConfig = { propertyId: "prop1" };
    const state = makeScenarioState([rentalProperty]);
    const result = rentalIncomeDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ kind: "simple", amount: poundsToPence(10_000), taxCategory: "rentalProfit" });
  });

  it("returns zero if the linked property can't be found", () => {
    const config: RentalIncomeConfig = { propertyId: "missing" };
    const state = makeScenarioState([rentalProperty]);
    const result = rentalIncomeDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ kind: "simple", amount: poundsToPence(0), taxCategory: "rentalProfit" });
  });
});

describe("rentalIncomeDefinition.isActive", () => {
  const config: RentalIncomeConfig = { propertyId: "prop1" };

  it("is active for an ordinary rental property with no planned sale", () => {
    const state = makeScenarioState([rentalProperty]);
    expect(rentalIncomeDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(true);
  });

  it("is inactive once the calendar year reaches the property's planned sale year", () => {
    const soldProperty: Property = { ...rentalProperty, plannedSale: { saleDate: "2030-06-01", sellingCosts: poundsToPence(5000) } };
    const state = makeScenarioState([soldProperty]);
    expect(rentalIncomeDefinition.isActive(config, state, yearContext(2029, 3), PERSON_ID)).toBe(true);
    expect(rentalIncomeDefinition.isActive(config, state, yearContext(2030, 4), PERSON_ID)).toBe(false);
  });

  it("is inactive for a main residence (not a rental)", () => {
    const { rentalDetails: _rentalDetails, ...rest } = rentalProperty;
    const mainResidence: Property = { ...rest, propertyType: "mainResidence" };
    const state = makeScenarioState([mainResidence]);
    expect(rentalIncomeDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(false);
  });

  it("is inactive if the linked property can't be found", () => {
    const state = makeScenarioState([]);
    expect(rentalIncomeDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(false);
  });
});

describe("rentalIncomeDefinition.validate", () => {
  it("hard-blocks a missing property selection", () => {
    const issues = rentalIncomeDefinition.validate({ propertyId: "" });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "propertyId", tier: "hardBlock" });
  });

  it("has no issues once a property is selected", () => {
    expect(rentalIncomeDefinition.validate({ propertyId: "prop1" })).toEqual([]);
  });
});

describe("rentalIncomeDefinition registry metadata", () => {
  it("declares the required taxCategory and a stable type key", () => {
    expect(rentalIncomeDefinition.type).toBe("rentalIncome");
    expect(rentalIncomeDefinition.taxCategory).toBe("rentalProfit");
  });
});
