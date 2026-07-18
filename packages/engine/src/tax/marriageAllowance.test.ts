import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { applyMarriageAllowanceTransfer } from "./marriageAllowance.js";

describe("applyMarriageAllowanceTransfer", () => {
  const personalAllowance = poundsToPence(12570);
  const basicRateUpperThreshold = poundsToPence(50270);
  const transferableAmount = poundsToPence(1260);

  it("applies the transfer when the transferor has spare allowance and the recipient is a basic-rate taxpayer", () => {
    const result = applyMarriageAllowanceTransfer(poundsToPence(8000), personalAllowance, poundsToPence(35000), basicRateUpperThreshold, transferableAmount);
    expect(result).toEqual({ applied: true, transferorAllowanceReduction: transferableAmount, recipientAllowanceIncrease: transferableAmount });
  });

  it("does not apply if the transferor's own income already exceeds their Personal Allowance", () => {
    const result = applyMarriageAllowanceTransfer(poundsToPence(13000), personalAllowance, poundsToPence(35000), basicRateUpperThreshold, transferableAmount);
    expect(result.applied).toBe(false);
    expect(result.transferorAllowanceReduction).toBe(0);
    expect(result.recipientAllowanceIncrease).toBe(0);
  });

  it("does not apply if the recipient is a higher-rate taxpayer", () => {
    const result = applyMarriageAllowanceTransfer(poundsToPence(8000), personalAllowance, poundsToPence(60000), basicRateUpperThreshold, transferableAmount);
    expect(result.applied).toBe(false);
  });

  it("applies exactly at the transferor's own allowance boundary", () => {
    const result = applyMarriageAllowanceTransfer(personalAllowance, personalAllowance, poundsToPence(35000), basicRateUpperThreshold, transferableAmount);
    expect(result.applied).toBe(true);
  });

  it("applies exactly at the recipient's basic-rate boundary", () => {
    const result = applyMarriageAllowanceTransfer(poundsToPence(8000), personalAllowance, basicRateUpperThreshold, basicRateUpperThreshold, transferableAmount);
    expect(result.applied).toBe(true);
  });

  it("does not apply if both people fail their own eligibility check", () => {
    const result = applyMarriageAllowanceTransfer(poundsToPence(20000), personalAllowance, poundsToPence(60000), basicRateUpperThreshold, transferableAmount);
    expect(result.applied).toBe(false);
  });
});
