import { minPence, multiplyPenceByRate, pence, subtractPence, zeroPence, type Pence } from "../money/pence.js";

export interface UfplsSplitResult {
  /** The portion of `grossAmount` that's tax-free (SPEC.md §5.7.2). */
  readonly taxFreeAmount: Pence;
  /** The remainder — taxed at the drawing person's marginal rate like any other pension income. */
  readonly taxableAmount: Pence;
  /** How much of `lumpSumAllowanceRemaining` this withdrawal consumed. */
  readonly lumpSumAllowanceUsed: Pence;
}

/**
 * UFPLS-style splitting of an uncrystallised pension withdrawal (SPEC.md
 * §5.7.2): each pound is 25% tax-free / 75% taxable until the person's
 * Lump Sum Allowance is exhausted, after which further withdrawals are
 * 100% taxable. A single withdrawal can straddle that boundary — the
 * portion within `lumpSumAllowanceRemaining` gets the 25/75 split, the
 * rest is fully taxable.
 */
export function splitUfplsWithdrawal(grossAmount: Pence, lumpSumAllowanceRemaining: Pence): UfplsSplitResult {
  if (grossAmount <= 0 || lumpSumAllowanceRemaining <= 0) {
    return { taxFreeAmount: zeroPence(), taxableAmount: grossAmount, lumpSumAllowanceUsed: zeroPence() };
  }

  // The gross amount whose 25% tax-free share still fits within the
  // remaining Lump Sum Allowance — i.e. up to 4x the remaining LSA.
  const grossCoveredByLsa = minPence(grossAmount, pence(lumpSumAllowanceRemaining * 4));
  const taxFreeAmount = multiplyPenceByRate(grossCoveredByLsa, 0.25);
  const taxableAmount = subtractPence(grossAmount, taxFreeAmount);

  return { taxFreeAmount, taxableAmount, lumpSumAllowanceUsed: taxFreeAmount };
}
