import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../../schema/types.js";
import type { ScenarioState, YearContext } from "../types.js";
import { pensionContributionDefinition, type PensionContributionConfig } from "./pensionContribution.js";

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

describe("pensionContributionDefinition.calculateForYear", () => {
  it("returns the configured contribution amount unchanged", () => {
    const config: PensionContributionConfig = {
      pensionAccountId: "acc1",
      reliefMethod: "reliefAtSource",
      annualContribution: poundsToPence(5000),
    };
    const result = pensionContributionDefinition.calculateForYear(config, makeScenarioState(), yearContext, PERSON_ID);
    expect(result).toEqual({ amount: poundsToPence(5000), taxTreatment: "reliefAtSourceBasicRateTopUp" });
  });
});

describe("pensionContributionDefinition.isActive", () => {
  it("is always active in Phase 1 (start/end-age bounding comes with the drawdown phase)", () => {
    const config: PensionContributionConfig = {
      pensionAccountId: "acc1",
      reliefMethod: "reliefAtSource",
      annualContribution: poundsToPence(5000),
    };
    expect(pensionContributionDefinition.isActive(config, makeScenarioState(), yearContext, PERSON_ID)).toBe(true);
  });
});

describe("pensionContributionDefinition.validate", () => {
  it("has no issues for a normal contribution", () => {
    const config: PensionContributionConfig = {
      pensionAccountId: "acc1",
      reliefMethod: "reliefAtSource",
      annualContribution: poundsToPence(5000),
    };
    expect(pensionContributionDefinition.validate(config)).toEqual([]);
  });

  it("hard-blocks a negative contribution", () => {
    const config: PensionContributionConfig = {
      pensionAccountId: "acc1",
      reliefMethod: "reliefAtSource",
      annualContribution: pence(-500),
    };
    const issues = pensionContributionDefinition.validate(config);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ field: "annualContribution", tier: "hardBlock" });
  });
});

describe("pensionContributionDefinition registry metadata", () => {
  it("declares the relief-at-source tax treatment", () => {
    expect(pensionContributionDefinition.type).toBe("pensionContribution");
    expect(pensionContributionDefinition.taxTreatment).toBe("reliefAtSourceBasicRateTopUp");
  });
});
