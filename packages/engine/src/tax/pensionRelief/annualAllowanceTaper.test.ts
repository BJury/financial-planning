import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { taperAnnualAllowance, type AnnualAllowanceTaperInputs } from "./annualAllowanceTaper.js";

const baseInputs: AnnualAllowanceTaperInputs = {
  thresholdIncome: poundsToPence(150000),
  adjustedIncome: poundsToPence(150000),
  standardAllowance: poundsToPence(60000),
  taperThresholdIncome: poundsToPence(200000),
  taperThresholdAdjustedIncome: poundsToPence(260000),
  taperMinimumAllowance: poundsToPence(10000),
};

describe("taperAnnualAllowance", () => {
  it("returns the standard allowance when neither threshold is breached", () => {
    expect(taperAnnualAllowance(baseInputs)).toBe(poundsToPence(60000));
  });

  it("returns the standard allowance when only adjusted income is breached, not threshold income", () => {
    const inputs = { ...baseInputs, adjustedIncome: poundsToPence(300000), thresholdIncome: poundsToPence(150000) };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(60000));
  });

  it("returns the standard allowance when only threshold income is breached, not adjusted income", () => {
    const inputs = { ...baseInputs, thresholdIncome: poundsToPence(250000), adjustedIncome: poundsToPence(255000) };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(60000));
  });

  it("tapers by £1 for every £2 of adjusted income above the threshold once both conditions are breached", () => {
    const inputs = {
      ...baseInputs,
      thresholdIncome: poundsToPence(250000),
      adjustedIncome: poundsToPence(280000), // £20,000 over the £260,000 threshold
    };
    // £20,000 excess -> £10,000 reduction
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(50000));
  });

  it("floors at the minimum allowance and never goes below it", () => {
    const inputs = {
      ...baseInputs,
      thresholdIncome: poundsToPence(500000),
      adjustedIncome: poundsToPence(1000000),
    };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(10000));
  });

  it("is exactly at the standard allowance right at the adjusted-income threshold", () => {
    const inputs = { ...baseInputs, thresholdIncome: poundsToPence(250000), adjustedIncome: poundsToPence(260000) };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(60000));
  });

  it("reaches exactly the minimum allowance at the known boundary (£360,000 adjusted income for a £60,000 standard allowance)", () => {
    const inputs = { ...baseInputs, thresholdIncome: poundsToPence(500000), adjustedIncome: poundsToPence(360000) };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(10000));
  });

  it("handles a zero standard allowance edge case gracefully", () => {
    const inputs = { ...baseInputs, standardAllowance: pence(0), thresholdIncome: poundsToPence(300000), adjustedIncome: poundsToPence(300000) };
    expect(taperAnnualAllowance(inputs)).toBe(poundsToPence(10000)); // still floors at minimum
  });
});
