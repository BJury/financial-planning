import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { salaryDefinition, type SalaryConfig } from "./salary.js";

const PERSON_ID = personId("p1");

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

const person: Person = {
  id: PERSON_ID,
  dateOfBirth: "1980-06-15",
  targetRetirementAge: 67,
  projectionEndAge: 95,
};

function yearContext(calendarYear: number, yearIndex: number): YearContext {
  return { taxYear: `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`, calendarYear, yearIndex };
}

describe("salaryDefinition.calculateForYear", () => {
  it("returns the base salary unchanged in year zero", () => {
    const config: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0.02 };
    const state = makeScenarioState([person]);
    const result = salaryDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    expect(result).toEqual({ kind: "simple", amount: poundsToPence(50000), taxCategory: "earnedIncome" });
  });

  it("compounds by the (already-real) annual growth rate over elapsed years", () => {
    const config: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0.02 };
    const state = makeScenarioState([person]);
    const result = salaryDefinition.calculateForYear(config, state, yearContext(2029, 3), PERSON_ID);
    expect(result.kind).toBe("simple");
    if (result.kind !== "simple") throw new Error("expected a simple result");
    // £50,000 * 1.02^3 = £53,060.40
    expect(result.amount).toBe(poundsToPence(50000 * Math.pow(1.02, 3)));
  });

  it("always declares taxCategory 'earnedIncome'", () => {
    const config: SalaryConfig = { grossAnnualSalary: poundsToPence(30000), annualGrowthRate: 0 };
    const state = makeScenarioState([person]);
    const result = salaryDefinition.calculateForYear(config, state, yearContext(2026, 0), PERSON_ID);
    if (result.kind !== "simple") throw new Error("expected a simple result");
    expect(result.taxCategory).toBe("earnedIncome");
  });
});

describe("salaryDefinition.isActive", () => {
  const config: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0.02, endAge: 67 };

  it("is active with no endAge configured, regardless of age", () => {
    const noEndAgeConfig: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0.02 };
    const state = makeScenarioState([person]);
    expect(salaryDefinition.isActive(noEndAgeConfig, state, yearContext(2090, 64), PERSON_ID)).toBe(true);
  });

  it("is active before the configured end age", () => {
    const state = makeScenarioState([person]);
    // person born 1980, so in 2026 they are 46 — well before endAge 67
    expect(salaryDefinition.isActive(config, state, yearContext(2026, 0), PERSON_ID)).toBe(true);
  });

  it("is inactive from the configured end age onward", () => {
    const state = makeScenarioState([person]);
    // in 2047 the person turns 67
    expect(salaryDefinition.isActive(config, state, yearContext(2047, 21), PERSON_ID)).toBe(false);
  });

  it("is inactive for an owner of 'joint' (a Salary can never actually be jointly owned)", () => {
    const state = makeScenarioState([person]);
    expect(salaryDefinition.isActive(config, state, yearContext(2026, 0), "joint")).toBe(false);
  });

  it("is inactive if the owning person can't be found in the household", () => {
    const state = makeScenarioState([person]);
    expect(salaryDefinition.isActive(config, state, yearContext(2026, 0), personId("unknown-person-id"))).toBe(
      false,
    );
  });
});

describe("salaryDefinition.validate", () => {
  it("has no issues for a normal configuration", () => {
    const config: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0.02 };
    expect(salaryDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative salary", () => {
    const config: SalaryConfig = { grossAnnualSalary: pence(-100), annualGrowthRate: 0.02 };
    const issues = salaryDefinition.validate(config);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "grossAnnualSalary", tier: "hardBlock" });
  });

  it("soft-warns on an extreme growth rate rather than blocking", () => {
    const config: SalaryConfig = { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 3 };
    const issues = salaryDefinition.validate(config);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualGrowthRate", tier: "softWarning" });
  });

  it("allows a zero salary (e.g. someone not currently earning)", () => {
    const config: SalaryConfig = { grossAnnualSalary: pence(0), annualGrowthRate: 0 };
    expect(salaryDefinition.validate(config)).toEqual([]);
  });
});

describe("salaryDefinition registry metadata", () => {
  it("declares the required taxCategory and a stable type key", () => {
    expect(salaryDefinition.type).toBe("salary");
    expect(salaryDefinition.taxCategory).toBe("earnedIncome");
  });

  it("has a field schema entry for every SalaryConfig field", () => {
    const keys = salaryDefinition.fields.map((f) => f.key);
    expect(keys).toContain("grossAnnualSalary");
    expect(keys).toContain("annualGrowthRate");
    expect(keys).toContain("endAge");
  });
});
