import { describe, expect, it } from "vitest";
import { pence, poundsToPence, zeroPence } from "../money/pence.js";
import { splitUfplsWithdrawal } from "./pensionLumpSum.js";

describe("splitUfplsWithdrawal", () => {
  it("splits 25% tax-free / 75% taxable when comfortably within the remaining Lump Sum Allowance", () => {
    const result = splitUfplsWithdrawal(poundsToPence(10000), poundsToPence(268275));
    expect(result.taxFreeAmount).toBe(poundsToPence(2500));
    expect(result.taxableAmount).toBe(poundsToPence(7500));
    expect(result.lumpSumAllowanceUsed).toBe(poundsToPence(2500));
  });

  it("is entirely taxable once the Lump Sum Allowance is already exhausted", () => {
    const result = splitUfplsWithdrawal(poundsToPence(10000), zeroPence());
    expect(result.taxFreeAmount).toBe(0);
    expect(result.taxableAmount).toBe(poundsToPence(10000));
    expect(result.lumpSumAllowanceUsed).toBe(0);
  });

  it("straddles the boundary: the portion within the LSA gets the 25/75 split, the rest is fully taxable", () => {
    // £2,000 of LSA remaining covers £8,000 gross (2000 * 4) at the 25/75 split;
    // the remaining £2,000 of a £10,000 withdrawal is fully taxable.
    const result = splitUfplsWithdrawal(poundsToPence(10000), poundsToPence(2000));
    expect(result.taxFreeAmount).toBe(poundsToPence(2000)); // 25% of £8,000
    expect(result.taxableAmount).toBe(poundsToPence(8000)); // £6,000 (75% of £8,000) + £2,000 fully taxable
    expect(result.lumpSumAllowanceUsed).toBe(poundsToPence(2000));
  });

  it("handles a zero withdrawal without error", () => {
    const result = splitUfplsWithdrawal(zeroPence(), poundsToPence(268275));
    expect(result.taxFreeAmount).toBe(0);
    expect(result.taxableAmount).toBe(0);
    expect(result.lumpSumAllowanceUsed).toBe(0);
  });

  it("the tax-free and taxable portions always sum back to the gross amount", () => {
    for (const [gross, lsa] of [
      [poundsToPence(5000), poundsToPence(1000)],
      [poundsToPence(50000), poundsToPence(268275)],
      [poundsToPence(1), poundsToPence(0)],
    ] as const) {
      const result = splitUfplsWithdrawal(gross, lsa);
      expect(pence(result.taxFreeAmount + result.taxableAmount)).toBe(gross);
    }
  });
});
