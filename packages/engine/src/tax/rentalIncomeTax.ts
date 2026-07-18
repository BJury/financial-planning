import { maxPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";

/**
 * Net rental profit before tax (SPEC.md §5.6) — the landlord may deduct
 * either their actual letting costs or a flat Property Income Allowance,
 * whichever is larger (more favourable), exactly as a real landlord
 * would choose. Floored at zero: a loss from actual expenses exceeding
 * income isn't carried forward in v1 (a documented simplification).
 */
export function calculateRentalProfit(grossRentalIncome: Pence, lettingCosts: Pence, propertyIncomeAllowance: Pence): Pence {
  const deduction = maxPence(lettingCosts, propertyIncomeAllowance);
  return maxPence(subtractPence(grossRentalIncome, deduction), zeroPence());
}

/**
 * The flat-rate mortgage interest tax credit (SPEC.md §5.6) — since the
 * 2020 rule change, mortgage interest on a rental property is **not**
 * deducted from rental profit before tax; instead the landlord gets this
 * credit against their overall Income Tax bill, at the basic rate
 * regardless of their own marginal rate. Kept as its own function,
 * separate from the Income Tax banding calculation rental profit itself
 * goes through, mirroring the fact that these are two genuinely separate
 * steps in real landlord tax (SPEC.md §9.3).
 */
export function calculateMortgageInterestCredit(interestPaid: Pence, basicRate: number): Pence {
  return multiplyPenceByRate(interestPaid, basicRate);
}
