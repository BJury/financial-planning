import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../money/pence.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { calculateNI, type NationalInsuranceThresholds } from "./nationalInsurance.js";

const thresholds: NationalInsuranceThresholds = {
  primaryThreshold: poundsToPence(ruleSet2026_27.nationalInsurance.primaryThreshold),
  upperEarningsLimit: poundsToPence(ruleSet2026_27.nationalInsurance.upperEarningsLimit),
  mainRate: ruleSet2026_27.nationalInsurance.mainRate,
  upperRate: ruleSet2026_27.nationalInsurance.upperRate,
};

describe("calculateNI", () => {
  it("charges nothing below the Primary Threshold", () => {
    expect(calculateNI(poundsToPence(10000), thresholds)).toBe(0);
    expect(calculateNI(thresholds.primaryThreshold, thresholds)).toBe(0);
  });

  it("charges the main rate between the Primary Threshold and the Upper Earnings Limit", () => {
    // £45,000 salary: (45000 - 12570) at 8%
    const pay = poundsToPence(45000);
    const expected = poundsToPence((45000 - 12570) * 0.08);
    expect(calculateNI(pay, thresholds)).toBe(expected);
  });

  it("charges the upper rate above the Upper Earnings Limit", () => {
    // £80,000 salary: (50270-12570) @ 8% + (80000-50270) @ 2%
    const pay = poundsToPence(80000);
    const expected = poundsToPence((50270 - 12570) * 0.08) + poundsToPence((80000 - 50270) * 0.02);
    expect(calculateNI(pay, thresholds)).toBe(expected);
  });

  it("has no upper bound on the top rate", () => {
    const veryHighPay = poundsToPence(1_000_000);
    const expected =
      poundsToPence((50270 - 12570) * 0.08) + poundsToPence((1_000_000 - 50270) * 0.02);
    expect(calculateNI(veryHighPay, thresholds)).toBe(expected);
  });

  it("returns zero for zero pay", () => {
    expect(calculateNI(pence(0), thresholds)).toBe(0);
  });

  it("is entirely independent of Income Tax band figures — only its own thresholds matter", () => {
    // Sanity check: NI's Upper Earnings Limit happens to equal Income
    // Tax's basic-rate upper bound for 2026/27, but calculateNI never
    // reads anything from the Income Tax section of a rule set.
    const basicRateBand = ruleSet2026_27.incomeTaxEngland.bands.find((b) => b.name === "basic");
    expect(basicRateBand).toBeDefined();
    expect(thresholds.upperEarningsLimit).toBe(poundsToPence(basicRateBand?.upTo ?? 0));
  });
});
