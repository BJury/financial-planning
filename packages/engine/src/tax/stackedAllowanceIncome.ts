import { addPence, minPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";
import type { RemainingBandHeadroom } from "./incomeTax.js";

/**
 * Taxes an income type that has its *own* allowance (e.g. the Personal
 * Savings Allowance, the Dividend Allowance) and stacks on top of a
 * person's other taxable income for the year (SPEC.md §5.5) — shared by
 * `savingsTax.ts` and `dividendTax.ts` rather than duplicated, since
 * both are the same shape: carve out the allowance (always 0%,
 * regardless of which band it lands in — the same principle as the
 * drawdown solver's UFPLS tax-free share, `drawdown/solveDrawdown.ts`),
 * then tax whatever's left at progressively higher rates as it climbs
 * through the remaining bands.
 *
 * `bandHeadroom` must already reflect the person's *other* income (via
 * `computeRemainingBandHeadroom`) — this function only ever stacks
 * `income` on top of it, never recomputes that baseline itself.
 */
export function taxStackedIncomeWithAllowance(
  income: Pence,
  allowance: Pence,
  bandHeadroom: readonly RemainingBandHeadroom[],
  rateForBand: (bandName: string) => number,
): Pence {
  let remainingAllowance = allowance;
  let remainingIncome = income;
  let tax = zeroPence();

  for (const band of bandHeadroom) {
    if (remainingIncome <= 0) break;

    const capacity = band.remainingWidth === null ? remainingIncome : minPence(band.remainingWidth, remainingIncome);
    if (capacity <= 0) continue;

    const allowanceUsedHere = minPence(remainingAllowance, capacity);
    const taxableHere = subtractPence(capacity, allowanceUsedHere);

    tax = addPence(tax, multiplyPenceByRate(taxableHere, rateForBand(band.name)));

    remainingAllowance = subtractPence(remainingAllowance, allowanceUsedHere);
    remainingIncome = subtractPence(remainingIncome, capacity);
  }

  return tax;
}
