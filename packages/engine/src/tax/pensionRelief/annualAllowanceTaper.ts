import { maxPence, multiplyPenceByRate, subtractPence, type Pence } from "../../money/pence.js";

export interface AnnualAllowanceTaperInputs {
  readonly thresholdIncome: Pence;
  readonly adjustedIncome: Pence;
  readonly standardAllowance: Pence;
  readonly taperThresholdIncome: Pence;
  readonly taperThresholdAdjustedIncome: Pence;
  readonly taperMinimumAllowance: Pence;
}

/**
 * Tapers the pension Annual Allowance for high earners (SPEC.md §5.4).
 * The taper applies only when **both** conditions are met — threshold
 * income exceeds its own threshold *and* adjusted income exceeds its own
 * (higher) threshold — not just one; someone who breaches only one of
 * the two keeps the full standard allowance. When both are breached, the
 * allowance reduces by £1 for every £2 of adjusted income above the
 * adjusted-income threshold, down to the minimum allowance.
 *
 * "adjusted net income" (Personal Allowance taper, §5.2) and "threshold
 * income"/"adjusted income" (Annual Allowance taper, here) are three
 * distinct HMRC-defined figures despite the similar names — the caller
 * is responsible for computing each correctly; this function only
 * applies the taper arithmetic once they're supplied (SPEC.md §5.4's
 * explicit warning against conflating them).
 */
export function taperAnnualAllowance(inputs: AnnualAllowanceTaperInputs): Pence {
  const {
    thresholdIncome,
    adjustedIncome,
    standardAllowance,
    taperThresholdIncome,
    taperThresholdAdjustedIncome,
    taperMinimumAllowance,
  } = inputs;

  const taperApplies = thresholdIncome > taperThresholdIncome && adjustedIncome > taperThresholdAdjustedIncome;
  if (!taperApplies) {
    return standardAllowance;
  }

  const excessAdjustedIncome = subtractPence(adjustedIncome, taperThresholdAdjustedIncome);
  const reduction = multiplyPenceByRate(excessAdjustedIncome, 0.5);
  const tapered = subtractPence(standardAllowance, reduction);

  return maxPence(tapered, taperMinimumAllowance);
}
