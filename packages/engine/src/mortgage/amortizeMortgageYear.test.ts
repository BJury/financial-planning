import { describe, expect, it } from "vitest";
import { poundsToPence, type Pence } from "../money/pence.js";
import { amortizeMortgageYear, deriveAnnualRepaymentMortgagePayment } from "./amortizeMortgageYear.js";

describe("amortizeMortgageYear", () => {
  it("splits a single-year repayment mortgage exactly (hand-verified): £10,000 at 10% for 1 year", () => {
    // Standard amortising payment: r(1+r)^n / ((1+r)^n - 1) * P = 0.1*1.1/0.1 * 10,000 = 1.1 * 10,000 = £11,000.
    const mortgage = { nominalInterestRate: 0.1, repaymentType: "repayment" as const, annualPayment: poundsToPence(11_000), termYears: 1 };
    const result = amortizeMortgageYear(poundsToPence(10_000), mortgage, 0);
    expect(result.nominalInterest).toBe(poundsToPence(1000)); // 10,000 * 10%
    expect(result.nominalCapitalRepaid).toBe(poundsToPence(10_000)); // 11,000 - 1,000
    expect(result.nominalBalanceAfter).toBe(poundsToPence(0));
  });

  it("charges less interest and repays more capital each successive year as the balance falls", () => {
    const mortgage = { nominalInterestRate: 0.05, repaymentType: "repayment" as const, annualPayment: poundsToPence(24_072.78), termYears: 20 };
    const year0 = amortizeMortgageYear(poundsToPence(300_000), mortgage, 0);
    const year1 = amortizeMortgageYear(year0.nominalBalanceAfter, mortgage, 1);
    expect(year1.nominalInterest).toBeLessThan(year0.nominalInterest);
    expect(year1.nominalCapitalRepaid).toBeGreaterThan(year0.nominalCapitalRepaid);
  });

  it("never repays more capital than the outstanding balance (final year)", () => {
    const mortgage = { nominalInterestRate: 0.05, repaymentType: "repayment" as const, annualPayment: poundsToPence(24_072.78), termYears: 20 };
    const result = amortizeMortgageYear(poundsToPence(500), mortgage, 0);
    expect(result.nominalCapitalRepaid).toBe(poundsToPence(500));
    expect(result.nominalBalanceAfter).toBe(poundsToPence(0));
  });

  it("charges interest but repays no capital on an interest-only mortgage", () => {
    const mortgage = { nominalInterestRate: 0.05, repaymentType: "interestOnly" as const, annualPayment: poundsToPence(15_000), termYears: 20 };
    const result = amortizeMortgageYear(poundsToPence(300_000), mortgage, 0);
    expect(result.nominalInterest).toBe(poundsToPence(15_000));
    expect(result.nominalCapitalRepaid).toBe(poundsToPence(0));
    expect(result.nominalBalanceAfter).toBe(poundsToPence(300_000));
  });

  it("stops all payments once the term has elapsed", () => {
    const mortgage = { nominalInterestRate: 0.05, repaymentType: "repayment" as const, annualPayment: poundsToPence(24_072.78), termYears: 20 };
    const result = amortizeMortgageYear(poundsToPence(50_000), mortgage, 20);
    expect(result.nominalInterest).toBe(poundsToPence(0));
    expect(result.nominalCapitalRepaid).toBe(poundsToPence(0));
    expect(result.nominalBalanceAfter).toBe(poundsToPence(50_000));
  });

  it("reports a zero balance as already paid off, never negative", () => {
    const mortgage = { nominalInterestRate: 0.05, repaymentType: "repayment" as const, annualPayment: poundsToPence(24_072.78), termYears: 20 };
    const result = amortizeMortgageYear(poundsToPence(0), mortgage, 5);
    expect(result.nominalBalanceAfter).toBe(poundsToPence(0));
  });
});

describe("deriveAnnualRepaymentMortgagePayment", () => {
  it("derives the standard amortising payment exactly (hand-verified): £10,000 at 10% for 1 year", () => {
    expect(deriveAnnualRepaymentMortgagePayment(poundsToPence(10_000), 0.1, 1)).toBe(poundsToPence(11_000));
  });

  it("splits the balance evenly across the term at a 0% rate", () => {
    expect(deriveAnnualRepaymentMortgagePayment(poundsToPence(100_000), 0, 10)).toBe(poundsToPence(10_000));
  });

  it("repays the whole balance immediately with a zero term", () => {
    expect(deriveAnnualRepaymentMortgagePayment(poundsToPence(100_000), 0.05, 0)).toBe(poundsToPence(100_000));
  });

  it("fully amortises a realistic mortgage to (approximately) zero by the end of its own derived term", () => {
    const balance = poundsToPence(300_000);
    const mortgage = {
      nominalInterestRate: 0.05,
      repaymentType: "repayment" as const,
      annualPayment: deriveAnnualRepaymentMortgagePayment(balance, 0.05, 20),
      termYears: 20,
    };
    let remaining: Pence = balance;
    for (let year = 0; year < mortgage.termYears; year++) {
      remaining = amortizeMortgageYear(remaining, mortgage, year).nominalBalanceAfter;
    }
    // Rounding to the penny each year can leave a tiny residual — well under £1.
    expect(Math.abs(remaining)).toBeLessThan(poundsToPence(1));
  });
});
