import { pence, type Pence } from "../../money/pence.js";
import { roundHalfAwayFromZero } from "../../money/rounding.js";
import type { IncomeTaxBand } from "../incomeTax.js";

/**
 * Grosses up a relief-at-source pension contribution: the employee pays
 * from net pay, and the provider adds basic-rate relief so the pension
 * pot receives more than was actually paid (SPEC.md §5.4). If
 * `netContribution` represents `(1 - basicRate)` of the gross amount,
 * the gross amount the pot receives is `netContribution / (1 - basicRate)`.
 */
export function grossUpAtBasicRate(netContribution: Pence, basicRate: number): Pence {
  return pence(roundHalfAwayFromZero(netContribution / (1 - basicRate)));
}

/**
 * Higher/additional-rate relief is reclaimed not by a further top-up
 * into the pot, but by extending the basic-rate and higher-rate band
 * *boundaries* by the gross contribution (SPEC.md §5.4) — more of the
 * person's income is taxed at a lower rate, rather than the pension pot
 * receiving more money. Only bands with a non-zero rate and a finite
 * upper bound are extended: the 0%-rate Personal Allowance band and the
 * unbounded top (additional-rate) band are left untouched, since neither
 * has a "ceiling" that relief-at-source extends.
 */
export function extendBandsForReliefAtSource(
  bands: readonly IncomeTaxBand[],
  grossContribution: Pence,
): readonly IncomeTaxBand[] {
  return bands.map((band) => {
    if (band.rate === 0 || band.upTo === null) {
      return band;
    }
    return { ...band, upTo: pence(band.upTo + grossContribution) };
  });
}
