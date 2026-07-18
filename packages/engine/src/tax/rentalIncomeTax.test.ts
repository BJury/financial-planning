import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { calculateMortgageInterestCredit, calculateRentalProfit } from "./rentalIncomeTax.js";

describe("calculateRentalProfit", () => {
  it("deducts actual letting costs when they exceed the Property Income Allowance", () => {
    const profit = calculateRentalProfit(poundsToPence(12_000), poundsToPence(3000), poundsToPence(1000));
    expect(profit).toBe(poundsToPence(9000));
  });

  it("deducts the Property Income Allowance instead when it's the larger (more favourable) deduction", () => {
    const profit = calculateRentalProfit(poundsToPence(12_000), poundsToPence(400), poundsToPence(1000));
    expect(profit).toBe(poundsToPence(11_000));
  });

  it("floors profit at zero rather than going negative", () => {
    const profit = calculateRentalProfit(poundsToPence(500), poundsToPence(2000), poundsToPence(1000));
    expect(profit).toBe(poundsToPence(0));
  });
});

describe("calculateMortgageInterestCredit", () => {
  it("credits interest paid at the basic rate, regardless of the landlord's own marginal rate", () => {
    expect(calculateMortgageInterestCredit(poundsToPence(10_000), 0.2)).toBe(poundsToPence(2000));
  });

  it("returns zero for zero interest paid", () => {
    expect(calculateMortgageInterestCredit(poundsToPence(0), 0.2)).toBe(poundsToPence(0));
  });
});
