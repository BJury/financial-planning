import { addPence, type Pence } from "../../money/pence.js";

export interface ThresholdAndAdjustedIncomeInputs {
  /**
   * Taxable earned income after any net-pay/salary-sacrifice pension
   * deductions, but *before* relief-at-source deductions — relief-at-source
   * contributions are paid from net pay and never reduced taxable income
   * in the first place, so there is nothing to subtract for them here.
   */
  readonly taxableIncomeAfterPensionDeductions: Pence;
  /**
   * Employment income given up under a salary sacrifice arrangement —
   * added back onto taxable income for threshold income purposes, per
   * HMRC's rule for arrangements set up to reduce pension-related income.
   */
  readonly salarySacrificeAmount: Pence;
  /** Every pension contribution for the year, gross, from every source (employee, relief-at-source top-up, employer). */
  readonly totalPensionInputAmount: Pence;
}

export interface ThresholdAndAdjustedIncomeResult {
  readonly thresholdIncome: Pence;
  readonly adjustedIncome: Pence;
}

/**
 * HMRC's two Annual Allowance taper income tests (SPEC.md §5.4) —
 * distinct from "adjusted net income" used for the Personal Allowance
 * taper (tax/incomeTax.ts's `taperPersonalAllowance`), despite the
 * similar name.
 */
export function calculateThresholdAndAdjustedIncome(
  inputs: Readonly<ThresholdAndAdjustedIncomeInputs>,
): ThresholdAndAdjustedIncomeResult {
  const thresholdIncome = addPence(inputs.taxableIncomeAfterPensionDeductions, inputs.salarySacrificeAmount);
  const adjustedIncome = addPence(thresholdIncome, inputs.totalPensionInputAmount);
  return { thresholdIncome, adjustedIncome };
}
