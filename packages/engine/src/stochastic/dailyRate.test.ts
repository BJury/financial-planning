import { describe, expect, it } from "vitest";
import { annualReturnViaDailyRate, daysInTaxYear } from "./dailyRate.js";

describe("daysInTaxYear", () => {
  it("is 366 when the tax year's Feb/Mar falls in a leap year", () => {
    // Tax year 2023-24 runs 6 Apr 2023 - 5 Apr 2024, and contains 29 Feb 2024.
    expect(daysInTaxYear(2023)).toBe(366);
  });

  it("is 365 when the tax year's Feb/Mar falls in a non-leap year", () => {
    // Tax year 2026-27 runs 6 Apr 2026 - 5 Apr 2027; 2027 isn't a leap year.
    expect(daysInTaxYear(2026)).toBe(365);
  });

  it("excludes a century year that isn't divisible by 400", () => {
    expect(daysInTaxYear(2099)).toBe(365); // 2100 isn't a leap year
  });

  it("includes a century year that is divisible by 400", () => {
    expect(daysInTaxYear(2399)).toBe(366); // 2400 is a leap year
  });
});

describe("annualReturnViaDailyRate", () => {
  it("reproduces the original annual rate (routing through a daily rate and back is a no-op by construction)", () => {
    for (const annualRate of [0.0889, -0.5, 0, 1.5, -0.99]) {
      expect(annualReturnViaDailyRate(annualRate, 365)).toBeCloseTo(annualRate, 12);
      expect(annualReturnViaDailyRate(annualRate, 366)).toBeCloseTo(annualRate, 12);
    }
  });
});
