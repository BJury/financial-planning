import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../../money/pence.js";
import { calculateThresholdAndAdjustedIncome } from "./annualAllowanceIncome.js";

describe("calculateThresholdAndAdjustedIncome", () => {
  it("adds salary-sacrificed pay back onto threshold income", () => {
    const result = calculateThresholdAndAdjustedIncome({
      taxableIncomeAfterPensionDeductions: poundsToPence(190000),
      salarySacrificeAmount: poundsToPence(20000),
      totalPensionInputAmount: zeroPence(),
    });
    expect(result.thresholdIncome).toBe(poundsToPence(210000));
  });

  it("adjusted income is threshold income plus every pension input, including employer contributions", () => {
    const result = calculateThresholdAndAdjustedIncome({
      taxableIncomeAfterPensionDeductions: poundsToPence(190000),
      salarySacrificeAmount: poundsToPence(20000),
      totalPensionInputAmount: poundsToPence(30000),
    });
    expect(result.thresholdIncome).toBe(poundsToPence(210000));
    expect(result.adjustedIncome).toBe(poundsToPence(240000));
  });

  it("with no salary sacrifice or pension input, both figures equal taxable income", () => {
    const result = calculateThresholdAndAdjustedIncome({
      taxableIncomeAfterPensionDeductions: poundsToPence(50000),
      salarySacrificeAmount: zeroPence(),
      totalPensionInputAmount: zeroPence(),
    });
    expect(result.thresholdIncome).toBe(poundsToPence(50000));
    expect(result.adjustedIncome).toBe(poundsToPence(50000));
  });
});
