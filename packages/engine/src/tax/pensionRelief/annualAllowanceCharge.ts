import { addPence, subtractPence, zeroPence, type Pence } from "../../money/pence.js";
import { applyIncomeTaxBands, type IncomeTaxBand } from "../incomeTax.js";

/**
 * The tax due on an Annual Allowance excess (SPEC.md §5.4) — modelled as
 * the marginal Income Tax the excess itself attracts, stacked on top of
 * the person's other taxable income, using the same band-stacking
 * function as ordinary Income Tax (§9.3) rather than a separate
 * AA-charge-specific rate table: `tax(otherTaxableIncome + excess) −
 * tax(otherTaxableIncome)`.
 */
export function calculateAnnualAllowanceCharge(
  otherTaxableIncome: Pence,
  excessContribution: Pence,
  fullBandStack: readonly IncomeTaxBand[],
): Pence {
  if (excessContribution <= 0) {
    return zeroPence();
  }

  const taxWithoutExcess = applyIncomeTaxBands(otherTaxableIncome, fullBandStack);
  const taxWithExcess = applyIncomeTaxBands(addPence(otherTaxableIncome, excessContribution), fullBandStack);

  return subtractPence(taxWithExcess, taxWithoutExcess);
}
