import type { Pence } from "../money/pence.js";
import { computeRemainingBandHeadroom, type IncomeTaxBand } from "./incomeTax.js";
import { taxStackedIncomeWithAllowance } from "./stackedAllowanceIncome.js";

export interface DividendRates {
  readonly basicRate: number;
  readonly higherRate: number;
  readonly additionalRate: number;
}

/**
 * Dividend income taxed via the Dividend Allowance (a flat amount,
 * unlike the Personal Savings Allowance — it doesn't vary by band), then
 * at dividend-specific rates — distinct from standard Income Tax rates —
 * stacked on top of `otherTaxableIncome` for the year (SPEC.md §5.5).
 * `bands` supplies the *thresholds* only (the same ones standard Income
 * Tax uses); the rates actually applied come from `dividendRates`.
 */
export function calculateDividendTax(
  otherTaxableIncome: Pence,
  dividendIncome: Pence,
  dividendAllowance: Pence,
  bands: readonly IncomeTaxBand[],
  dividendRates: DividendRates,
): Pence {
  const bandHeadroom = computeRemainingBandHeadroom(bands, otherTaxableIncome);
  const rateForBand = (name: string) => {
    if (name === "basic") return dividendRates.basicRate;
    if (name === "higher") return dividendRates.higherRate;
    if (name === "additional") return dividendRates.additionalRate;
    return 0; // the Personal Allowance band — 0% for dividends too, same as ordinary income
  };
  return taxStackedIncomeWithAllowance(dividendIncome, dividendAllowance, bandHeadroom, rateForBand);
}
