import { minPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";

export interface GiaWithdrawalSplitResult {
  /** Tax-free (SPEC.md §5.7.2) — proportional to the account's cost basis share of its balance. */
  readonly returnOfCapitalAmount: Pence;
  /** Subject to CGT — proportional to the account's unrealised-gain share of its balance. */
  readonly gainAmount: Pence;
}

/**
 * Splits a GIA withdrawal proportionally into its return-of-capital and
 * realised-gain components (SPEC.md §5.5, §5.7.2) — unlike a pension's
 * UFPLS split, the ratio here doesn't deplete over time (there's no
 * per-account allowance being consumed); it's simply the account's
 * current cost-basis share of its balance, applied to whatever's drawn.
 * An account with no unrealised gain (cost basis at or above balance,
 * e.g. after a market fall) is entirely return of capital.
 */
export function splitGiaWithdrawal(grossAmount: Pence, costBasis: Pence, balance: Pence): GiaWithdrawalSplitResult {
  if (grossAmount <= 0 || balance <= 0) {
    return { returnOfCapitalAmount: zeroPence(), gainAmount: zeroPence() };
  }

  const costBasisFraction = Math.min(1, costBasis / balance);
  const returnOfCapitalAmount = minPence(grossAmount, multiplyPenceByRate(grossAmount, costBasisFraction));
  const gainAmount = subtractPence(grossAmount, returnOfCapitalAmount);

  return { returnOfCapitalAmount, gainAmount };
}
