import { compoundPenceByRate, type Pence } from "../money/pence.js";
import { convertNominalToReal } from "./convertNominalToReal.js";

/**
 * Converts a one-off nominal (actual future £) amount arising in
 * `yearsElapsed` years' time into today's money, using the same
 * Fisher-equation machinery as `uprateThreshold`'s `frozenNominal` policy
 * (SPEC.md §5.8) — but as a standalone helper for a single already-known
 * nominal figure (e.g. this year's mortgage interest, computed fresh each
 * year from a running nominal balance) rather than a persistent threshold
 * uprated year over year.
 */
export function deflateNominalAmount(nominalAmount: Pence, inflationRate: number, yearsElapsed: number): Pence {
  if (yearsElapsed <= 0) {
    return nominalAmount;
  }
  const realRate = convertNominalToReal(0, inflationRate);
  return compoundPenceByRate(nominalAmount, realRate, yearsElapsed);
}
