import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { isaContributionDefinition, type IsaContributionConfig } from "./isaContribution.js";

const PERSON_ID = personId("p1");

function makeScenarioState(): ScenarioState {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
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

describe("isaContributionDefinition.calculateForYear", () => {
  it("returns the configured contribution amount with taxTreatment 'none'", () => {
    const config: IsaContributionConfig = { isaAccountId: "acc1", annualContribution: poundsToPence(20000) };
    const result = isaContributionDefinition.calculateForYear(config, makeScenarioState(), yearContext, PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(20000), taxTreatment: "none" });
  });
});

describe("isaContributionDefinition.validate", () => {
  it("has no issues for a normal contribution", () => {
    const config: IsaContributionConfig = { isaAccountId: "acc1", annualContribution: poundsToPence(20000) };
    expect(isaContributionDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative contribution", () => {
    const config: IsaContributionConfig = { isaAccountId: "acc1", annualContribution: pence(-1) };
    const issues = isaContributionDefinition.validate(config);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualContribution", tier: "hardBlock" });
  });
});

describe("isaContributionDefinition registry metadata", () => {
  it("declares no tax treatment (funded from already-taxed income)", () => {
    expect(isaContributionDefinition.type).toBe("isaContribution");
    expect(isaContributionDefinition.taxTreatment).toBe("none");
  });
});
