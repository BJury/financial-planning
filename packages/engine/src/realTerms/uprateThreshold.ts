import { compoundPenceByRate, type Pence } from "../money/pence.js";
import { convertNominalToReal } from "./convertNominalToReal.js";

/**
 * How a tax threshold behaves in years beyond the latest confirmed
 * TaxYearRuleSet (SPEC.md §3.10, §5.8, §6.2). All three policies are
 * implemented now, in Phase 1, even though early scenarios only ever
 * exercise `inflationLinked` — deferring the other two risks early code
 * being written against an implicit "thresholds never change" assumption
 * that later has to be unwound (SPEC.md implementation plan, risk #4).
 */
export type UpratingPolicy =
  | { readonly kind: "inflationLinked" }
  | { readonly kind: "frozenNominal" }
  | { readonly kind: "customRate"; readonly nominalRate: number };

/**
 * Projects a threshold's real value forward by `yearsElapsed` years from
 * the latest confirmed tax year, per the chosen uprating policy.
 *
 * - `inflationLinked`: the real value is simply returned unchanged — this
 *   is the entire point of working in real terms by default (§5.8): a
 *   threshold that keeps pace with inflation requires no calculation.
 * - `frozenNominal`: the threshold is fixed in cash (nominal) terms, so
 *   its real value erodes — modelled as compounding at a real rate
 *   derived from 0% nominal growth against the given inflation rate
 *   (the Fisher-equation conversion, same as any other nominal->real
 *   conversion in this engine).
 * - `customRate`: the threshold grows at a user-specified nominal rate,
 *   converted to real the same way.
 */
export function uprateThreshold(
  baseRealValue: Pence,
  policy: UpratingPolicy,
  inflationRate: number,
  yearsElapsed: number,
): Pence {
  if (yearsElapsed <= 0) {
    return baseRealValue;
  }

  if (policy.kind === "inflationLinked") {
    return baseRealValue;
  }

  const nominalRate = policy.kind === "frozenNominal" ? 0 : policy.nominalRate;
  const realRate = convertNominalToReal(nominalRate, inflationRate);

  return compoundPenceByRate(baseRealValue, realRate, yearsElapsed);
}
