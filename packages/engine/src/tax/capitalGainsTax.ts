import type { Pence } from "../money/pence.js";
import { computeRemainingBandHeadroom, type IncomeTaxBand } from "./incomeTax.js";
import { taxStackedIncomeWithAllowance } from "./stackedAllowanceIncome.js";

export interface CapitalGainsRates {
  readonly basicRate: number;
  readonly higherRate: number;
}

/**
 * Realised capital gains taxed via the (annual, not lifetime — SPEC.md
 * §5.5) CGT Annual Exempt Amount, then at one of only two rates —
 * basic or higher — determined by where the gain, stacked on top of
 * `otherTaxableIncome`, lands in the person's Income Tax bands. There's
 * no separate "additional rate" CGT tier: anyone in the additional-rate
 * Income Tax band still pays the CGT higher rate.
 */
export function calculateCapitalGainsTax(
  otherTaxableIncome: Pence,
  gainAmount: Pence,
  annualExemptAmount: Pence,
  bands: readonly IncomeTaxBand[],
  cgtRates: CapitalGainsRates,
): Pence {
  const bandHeadroom = computeRemainingBandHeadroom(bands, otherTaxableIncome);
  const rateForBand = (name: string) => (name === "higher" || name === "additional" ? cgtRates.higherRate : cgtRates.basicRate);
  return taxStackedIncomeWithAllowance(gainAmount, annualExemptAmount, bandHeadroom, rateForBand);
}
