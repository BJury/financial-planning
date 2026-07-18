import { zeroPence, type Pence } from "../money/pence.js";

export interface MarriageAllowanceResult {
  readonly applied: boolean;
  readonly transferorAllowanceReduction: Pence;
  readonly recipientAllowanceIncrease: Pence;
}

/**
 * Marriage Allowance (SPEC.md §5.2): a fixed amount (from the tax table,
 * not dynamically 10% of whatever headroom the transferor happens to
 * have) moves from a person who doesn't need their full Personal
 * Allowance to their spouse/civil partner, provided the recipient stays
 * a basic-rate taxpayer. Both eligibility conditions are checked fresh
 * every year — the *election* (who transfers to whom) is the user's
 * standing choice (SPEC.md's "user-toggleable, not auto-applied"), but
 * whether it actually takes effect in a given year is not: HMRC would
 * refuse the transfer once either person stops qualifying, and this
 * engine must too, deliberately declining rather than always honouring
 * the election.
 *
 * `transferorPersonalAllowance` and `recipientBasicRateUpperThreshold`
 * are each person's own, *pre-transfer* figures (the recipient's own
 * top-of-basic-band ceiling) — this function never recomputes tax bands
 * itself (SPEC.md §9.3).
 */
export function applyMarriageAllowanceTransfer(
  transferorTaxableIncome: Pence,
  transferorPersonalAllowance: Pence,
  recipientTaxableIncome: Pence,
  recipientBasicRateUpperThreshold: Pence,
  transferableAmount: Pence,
): MarriageAllowanceResult {
  const transferorEligible = transferorTaxableIncome <= transferorPersonalAllowance;
  const recipientEligible = recipientTaxableIncome <= recipientBasicRateUpperThreshold;

  if (!transferorEligible || !recipientEligible) {
    return { applied: false, transferorAllowanceReduction: zeroPence(), recipientAllowanceIncrease: zeroPence() };
  }

  return { applied: true, transferorAllowanceReduction: transferableAmount, recipientAllowanceIncrease: transferableAmount };
}
