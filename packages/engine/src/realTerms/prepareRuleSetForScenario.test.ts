import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { prepareRuleSetForScenario } from "./prepareRuleSetForScenario.js";
import type { UpratingPolicy } from "./uprateThreshold.js";

describe("prepareRuleSetForScenario", () => {
  it("at zero years elapsed, matches the confirmed rule set's own figures exactly, regardless of policy", () => {
    const policies: UpratingPolicy[] = [
      { kind: "inflationLinked" },
      { kind: "frozenNominal" },
      { kind: "customRate", nominalRate: 0.03 },
    ];
    for (const policy of policies) {
      const prepared = prepareRuleSetForScenario(ruleSet2026_27, policy, 0.025, 0);
      expect(prepared.personalAllowance).toBe(poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowance));
      expect(prepared.nationalInsurance.primaryThreshold).toBe(poundsToPence(ruleSet2026_27.nationalInsurance.primaryThreshold));
    }
  });

  it("holds every figure exactly flat under inflationLinked, for any number of years", () => {
    const prepared0 = prepareRuleSetForScenario(ruleSet2026_27, { kind: "inflationLinked" }, 0.025, 0);
    const prepared10 = prepareRuleSetForScenario(ruleSet2026_27, { kind: "inflationLinked" }, 0.025, 10);
    expect(prepared10.personalAllowance).toBe(prepared0.personalAllowance);
    expect(prepared10.personalAllowanceTaperThreshold).toBe(prepared0.personalAllowanceTaperThreshold);
    expect(prepared10.nationalInsurance).toEqual(prepared0.nationalInsurance);

    const basic0 = prepared0.incomeTaxBands.find((b) => b.name === "basic");
    const basic10 = prepared10.incomeTaxBands.find((b) => b.name === "basic");
    expect(basic10?.upTo).toBe(basic0?.upTo);
  });

  it("erodes every figure in real terms under frozenNominal, for a positive inflation rate", () => {
    const prepared0 = prepareRuleSetForScenario(ruleSet2026_27, { kind: "frozenNominal" }, 0.025, 0);
    const prepared10 = prepareRuleSetForScenario(ruleSet2026_27, { kind: "frozenNominal" }, 0.025, 10);
    expect(prepared10.personalAllowance).toBeLessThan(prepared0.personalAllowance);

    const basic0 = prepared0.incomeTaxBands.find((b) => b.name === "basic");
    const basic10 = prepared10.incomeTaxBands.find((b) => b.name === "basic");
    expect(basic10?.upTo).toBeLessThan(basic0?.upTo ?? 0);
  });

  it("leaves the unbounded (additional-rate) band's null upper bound untouched", () => {
    const prepared = prepareRuleSetForScenario(ruleSet2026_27, { kind: "frozenNominal" }, 0.025, 10);
    const additional = prepared.incomeTaxBands.find((b) => b.name === "additional");
    expect(additional?.upTo).toBeNull();
  });

  it("carries the rate figures (NI rates, taper rate) through unchanged, since only monetary thresholds are uprated", () => {
    const prepared = prepareRuleSetForScenario(ruleSet2026_27, { kind: "frozenNominal" }, 0.025, 10);
    expect(prepared.nationalInsurance.mainRate).toBe(ruleSet2026_27.nationalInsurance.mainRate);
    expect(prepared.nationalInsurance.upperRate).toBe(ruleSet2026_27.nationalInsurance.upperRate);
    expect(prepared.personalAllowanceTaperRate).toBe(ruleSet2026_27.incomeTaxEngland.personalAllowanceTaperRate);
  });
});
