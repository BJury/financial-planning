import { maxPence, minPence, multiplyPenceByRate, pence, subtractPence, zeroPence, type Pence } from "../money/pence.js";
import type { Mortgage } from "../schema/types.js";

export interface MortgageYearAmortization {
  readonly nominalInterest: Pence;
  readonly nominalCapitalRepaid: Pence;
  readonly nominalBalanceAfter: Pence;
}

/**
 * Splits one year of a mortgage into interest and capital, entirely in
 * **nominal** pounds (`schema/types.ts`'s `Mortgage` doc comment explains
 * why) — a rental property's Income Tax calculation needs the interest
 * portion specifically, not a single blended payment (SPEC.md §3.8, §5.6).
 *
 * `yearsElapsedInTerm` is 0-based (0 = the mortgage's first simulated
 * year). Once the term has elapsed, no further payments are modelled —
 * a repayment mortgage's balance is already ~0 by construction at that
 * point; an interest-only mortgage's remaining balance simply stays
 * outstanding (settling it via remortgage/sale at term end isn't
 * modelled, SPEC.md §3.8's overpayments/reversion-rate simplifications).
 */
export function amortizeMortgageYear(
  nominalBalance: Pence,
  mortgage: Pick<Mortgage, "nominalInterestRate" | "repaymentType" | "annualPayment" | "termYears">,
  yearsElapsedInTerm: number,
): MortgageYearAmortization {
  if (yearsElapsedInTerm >= mortgage.termYears || nominalBalance <= 0) {
    return { nominalInterest: zeroPence(), nominalCapitalRepaid: zeroPence(), nominalBalanceAfter: maxPence(nominalBalance, zeroPence()) };
  }

  const nominalInterest = multiplyPenceByRate(nominalBalance, mortgage.nominalInterestRate);
  const nominalCapitalRepaid =
    mortgage.repaymentType === "repayment"
      ? minPence(maxPence(subtractPence(mortgage.annualPayment, nominalInterest), zeroPence()), nominalBalance)
      : zeroPence();

  return {
    nominalInterest,
    nominalCapitalRepaid,
    nominalBalanceAfter: subtractPence(nominalBalance, nominalCapitalRepaid),
  };
}

/**
 * Standard amortising-loan payment formula — used by the UI to suggest a
 * sensible `Mortgage.annualPayment` default, which the user can then
 * override (SPEC.md §3.8's "monthly payment (derived or user-entered)").
 * Derived once from the mortgage's starting terms, exactly as a real
 * fixed-rate mortgage's payment is set once and then held flat for the
 * term — never re-derived from a later, smaller balance.
 */
export function deriveAnnualRepaymentMortgagePayment(balance: Pence, nominalInterestRate: number, termYears: number): Pence {
  if (termYears <= 0) {
    return balance;
  }
  if (nominalInterestRate === 0) {
    return pence(Math.round(balance / termYears));
  }
  const r = nominalInterestRate;
  const factor = (r * Math.pow(1 + r, termYears)) / (Math.pow(1 + r, termYears) - 1);
  return pence(Math.round(balance * factor));
}
