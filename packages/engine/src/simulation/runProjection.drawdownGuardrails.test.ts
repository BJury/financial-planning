import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import type { DrawdownGuardrailPolicy } from "../drawdown/guytonKlinger.js";
import { runProjection } from "./runProjection.js";

import "../catalog/incomeSources/targetDrawdownIncome.js";

const PERSON_ID = personId("p1");
const OTHER_PERSON_ID = personId("p2");

const POLICY: DrawdownGuardrailPolicy = { cutTriggerPct: 0.2, cutAmountPct: 0.1, raiseTriggerPct: 0.2, raiseAmountPct: 0.1 };

// £1,000,000 ISA against a £50,000 target is a 5% initial rate; a -5%
// annual growth rate shrinks the pool fast enough that the withdrawal
// rate crosses the 20%-above-baseline (6%) cut trigger by yearIndex 2,
// hand-verified: y0 pool 1,000,000 (rate 5%, baseline, no event) -> after
// £50,000 drawn + -5% growth -> y1 pool 902,500 (rate ~5.54%, no event)
// -> after another £50,000 drawn + -5% growth -> y2 pool 809,875 (rate
// ~6.17%, past the 6% trigger) -> cut to £45,000.
function makeScenario(): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1986-01-01", targetRetirementAge: 67, projectionEndAge: 90 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    household,
    accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000000), annualGrowthRate: -0.05 }],
    incomeSources: [
      { id: "target1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
    ],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runProjection — drawdownGuardrails", () => {
  it("omitting the parameter leaves guardrailAdjustment absent on every row, and reproduces identical output to today", () => {
    const withNoParam = runProjection(makeScenario(), ruleSet2026_27, 3, undefined);
    const withExplicitUndefined = runProjection(makeScenario(), ruleSet2026_27, 3, undefined, undefined);
    expect(withExplicitUndefined).toEqual(withNoParam);
    for (const row of withNoParam.rows) {
      for (const person of row.perPerson) expect(person.guardrailAdjustment).toBeUndefined();
    }
  });

  it("a shrinking portfolio triggers a cut once the withdrawal rate drifts far enough above the baseline, reducing that year's achieved income versus the un-guarded baseline", () => {
    const baseline = runProjection(makeScenario(), ruleSet2026_27, 3);
    const guarded = runProjection(makeScenario(), ruleSet2026_27, 3, undefined, POLICY);

    expect(guarded.rows[0]?.perPerson[0]?.guardrailAdjustment).toBe("none");
    expect(guarded.rows[1]?.perPerson[0]?.guardrailAdjustment).toBe("none");
    expect(guarded.rows[2]?.perPerson[0]?.guardrailAdjustment).toBe("cut");

    expect(baseline.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(50000));
    expect(guarded.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(45000));
  });

  it("a joint target sets the same guardrail event on both people's rows", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1986-01-01", targetRetirementAge: 67, projectionEndAge: 90 };
    const other: Person = { id: OTHER_PERSON_ID, dateOfBirth: "1986-01-01", targetRetirementAge: 67, projectionEndAge: 90 };
    const household: Household = { people: [person, other], relationshipStatus: "marriedOrCivilPartnership", targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      // Same £1,000,000 total pool as the single-person scenario above, split evenly, so the household reaches the same cut trigger by yearIndex 2.
      accounts: [
        { kind: "isa", id: "isaA", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(500000), annualGrowthRate: -0.05 },
        { kind: "isa", id: "isaB", owner: OTHER_PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(500000), annualGrowthRate: -0.05 },
      ],
      incomeSources: [{ id: "jointTarget", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const guarded = runProjection(scenario, ruleSet2026_27, 3, undefined, POLICY);
    const [personRow, otherRow] = guarded.rows[2]?.perPerson ?? [];
    expect(personRow?.guardrailAdjustment).toBe("cut");
    expect(otherRow?.guardrailAdjustment).toBe("cut");
  });

  it("a phase transition resets the guardrail baseline instead of carrying the previous phase's cut/raise state forward", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1986-01-01", targetRetirementAge: 67, projectionEndAge: 90 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000000), annualGrowthRate: -0.05 }],
      incomeSources: [
        // Phase 1: ages 40-42 (implicitly ends where phase 2 starts) — identical to the single-phase scenario above, so it cuts at yearIndex 2 (age 42) the same way.
        { id: "phase1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 40 } },
        // Phase 2: from age 43 (yearIndex 3) — a deliberately different target, first activation of a brand-new source id.
        { id: "phase2", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(30000), startAge: 43 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const guarded = runProjection(scenario, ruleSet2026_27, 4, undefined, POLICY);
    expect(guarded.rows[2]?.perPerson[0]?.guardrailAdjustment).toBe("cut");
    // Phase 2's first active year establishes its own fresh baseline from its own £30,000 target — "none", not a continuation of phase 1's cut.
    expect(guarded.rows[3]?.perPerson[0]?.guardrailAdjustment).toBe("none");
  });
});
