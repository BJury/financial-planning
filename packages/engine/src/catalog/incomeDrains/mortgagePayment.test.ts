import { describe, expect, it } from "vitest";
import { poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Property, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { mortgagePaymentDefinition, type MortgagePaymentConfig } from "./mortgagePayment.js";

const PERSON_ID = personId("p1");
const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };

const mortgagedProperty: Property = {
  id: "prop1",
  kind: "property",
  owner: PERSON_ID,
  propertyType: "mainResidence",
  currentBalance: poundsToPence(400_000),
  annualGrowthRate: 0.02,
  purchasePrice: poundsToPence(350_000),
  purchaseDate: "2020-01-01",
  mortgage: { initialBalance: poundsToPence(300_000), nominalInterestRate: 0.05, repaymentType: "repayment", termYears: 20, annualPayment: poundsToPence(24_072.78) },
};

function makeScenarioState(accounts: Scenario["accounts"], inflationRate = 0.025): ScenarioState {
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  const scenario: Scenario = {
    schemaVersion: 1,
    household,
    accounts,
    incomeSources: [],
    incomeDrains: [],
    inflationRate,
    upratingPolicy: { kind: "inflationLinked" },
  };
  return { scenario, accountBalances: new Map() };
}

function yearContext(calendarYear: number, yearIndex: number): YearContext {
  return { taxYear: `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`, calendarYear, yearIndex };
}

describe("mortgagePaymentDefinition.calculateForYear", () => {
  it("returns the nominal payment unchanged in year zero", () => {
    const config: MortgagePaymentConfig = { propertyId: "prop1" };
    const state = makeScenarioState([mortgagedProperty]);
    const result = mortgagePaymentDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(24_072.78), taxTreatment: "none" });
  });

  it("deflates the flat nominal payment to a declining real amount in later years", () => {
    const config: MortgagePaymentConfig = { propertyId: "prop1" };
    const state = makeScenarioState([mortgagedProperty]);
    const result = mortgagePaymentDefinition.calculateForYear(config, state, yearContext(2027, 1), PERSON_ID);
    expect(result.amount).toBeLessThan(poundsToPence(24_072.78));
  });

  it("returns zero for a property with no mortgage", () => {
    const config: MortgagePaymentConfig = { propertyId: "prop1" };
    const { mortgage: _mortgage, ...propertyWithoutMortgage } = mortgagedProperty;
    const state = makeScenarioState([propertyWithoutMortgage]);
    const result = mortgagePaymentDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(0), taxTreatment: "none" });
  });
});

describe("mortgagePaymentDefinition.isActive", () => {
  const config: MortgagePaymentConfig = { propertyId: "prop1" };

  it("is active within the mortgage's term", () => {
    const state = makeScenarioState([mortgagedProperty]);
    expect(mortgagePaymentDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(true);
  });

  it("is inactive once the mortgage's term has elapsed", () => {
    const state = makeScenarioState([mortgagedProperty]);
    expect(mortgagePaymentDefinition.isActive(config, state, yearContext(2046, 20), PERSON_ID)).toBe(false);
  });

  it("is inactive once the property has been sold", () => {
    const soldProperty: Property = { ...mortgagedProperty, plannedSale: { saleDate: "2030-06-01", sellingCosts: poundsToPence(5000) } };
    const state = makeScenarioState([soldProperty]);
    expect(mortgagePaymentDefinition.isActive(config, state, yearContext(2030, 4), PERSON_ID)).toBe(false);
  });

  it("is inactive for a property with no mortgage", () => {
    const { mortgage: _mortgage, ...propertyWithoutMortgage } = mortgagedProperty;
    const state = makeScenarioState([propertyWithoutMortgage]);
    expect(mortgagePaymentDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(false);
  });
});

describe("mortgagePaymentDefinition registry metadata", () => {
  it("declares the required taxTreatment and a stable type key", () => {
    expect(mortgagePaymentDefinition.type).toBe("mortgagePayment");
    expect(mortgagePaymentDefinition.taxTreatment).toBe("none");
  });
});
