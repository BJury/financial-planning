import type { Pence } from "../money/pence.js";
import { applyIncomeTaxBands, type IncomeTaxBand } from "./incomeTax.js";

export interface NationalInsuranceThresholds {
  readonly primaryThreshold: Pence;
  readonly upperEarningsLimit: Pence;
  readonly mainRate: number;
  readonly upperRate: number;
}

/**
 * Class 1 employee National Insurance on annual pay (SPEC.md §5.3):
 * 0% up to the Primary Threshold, `mainRate` between the Primary
 * Threshold and the Upper Earnings Limit, `upperRate` above it.
 *
 * Kept as its own named function, independent of `applyIncomeTaxBands`
 * as a *public entry point* — NI and Income Tax are genuinely separate
 * calculations in UK tax law (§9.3) and must never be conflated by a
 * caller — even though it happens to reuse the same marginal-band
 * arithmetic internally, since that's exactly what NI's threshold
 * structure is: a band stack with a 0% band, one middle rate, and one
 * top rate, with no upper bound.
 */
export function calculateNI(pay: Pence, thresholds: NationalInsuranceThresholds): Pence {
  const bands: readonly IncomeTaxBand[] = [
    { name: "belowPrimaryThreshold", upTo: thresholds.primaryThreshold, rate: 0 },
    { name: "mainRate", upTo: thresholds.upperEarningsLimit, rate: thresholds.mainRate },
    { name: "upperRate", upTo: null, rate: thresholds.upperRate },
  ];

  return applyIncomeTaxBands(pay, bands);
}
