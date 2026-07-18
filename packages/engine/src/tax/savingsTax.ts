import type { Pence } from "../money/pence.js";
import { computeRemainingBandHeadroom, type IncomeTaxBand } from "./incomeTax.js";
import { taxStackedIncomeWithAllowance } from "./stackedAllowanceIncome.js";

export interface SavingsAllowanceByBand {
  readonly basicRatePayer: Pence;
  readonly higherRatePayer: Pence;
  readonly additionalRatePayer: Pence;
}

/**
 * The Personal Savings Allowance varies by the size of the taxpayer's
 * *other* income (SPEC.md §5.5) — determined here by which band that
 * income's marginal pound falls into. A known v1 simplification: the
 * separate 0% starting rate for savings (up to £5,000, for very low
 * earners) isn't modelled — this treats anyone not paying higher/
 * additional rate tax as a basic-rate payer for PSA purposes, which is
 * never *more* generous than the real rule, only occasionally less so.
 */
export function determinePersonalSavingsAllowance(
  otherTaxableIncome: Pence,
  bands: readonly IncomeTaxBand[],
  savingsAllowance: SavingsAllowanceByBand,
): Pence {
  for (const band of bands) {
    if (band.upTo === null || otherTaxableIncome <= band.upTo) {
      if (band.name === "higher") return savingsAllowance.higherRatePayer;
      if (band.name === "additional") return savingsAllowance.additionalRatePayer;
      return savingsAllowance.basicRatePayer;
    }
  }
  return savingsAllowance.additionalRatePayer;
}

/**
 * Interest income taxed via the Personal Savings Allowance, then at the
 * same marginal Income Tax rates as any other income, stacked on top of
 * `otherTaxableIncome` for the year (SPEC.md §5.5).
 */
export function calculateSavingsTax(otherTaxableIncome: Pence, savingsIncome: Pence, personalSavingsAllowance: Pence, bands: readonly IncomeTaxBand[]): Pence {
  const bandHeadroom = computeRemainingBandHeadroom(bands, otherTaxableIncome);
  const rateForBand = (name: string) => bands.find((b) => b.name === name)?.rate ?? 0;
  return taxStackedIncomeWithAllowance(savingsIncome, personalSavingsAllowance, bandHeadroom, rateForBand);
}
