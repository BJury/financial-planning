import { addPence, maxPence, minPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";

/**
 * A single Income Tax band, denominated in Pence (already converted from
 * the pounds-denominated TaxYearRuleSet, and already real-terms-deflated
 * — see realTerms/prepareRuleSetForScenario.ts).
 */
export interface IncomeTaxBand {
  readonly name: string;
  /** Upper bound of cumulative taxable income covered by this band, or `null` for the top (unbounded) band. */
  readonly upTo: Pence | null;
  readonly rate: number;
}

/** How much of one band a specific amount of taxable income actually used, and the tax it generated — the per-band detail behind a single `applyIncomeTaxBands` total (SPEC.md §4 journey 5's "Income Tax by band"). */
export interface IncomeTaxBandBreakdown {
  readonly name: string;
  readonly rate: number;
  readonly taxableAmount: Pence;
  readonly tax: Pence;
}

/**
 * The band-by-band detail behind `applyIncomeTaxBands` — every band is
 * always present in the result (even at £0), so a UI can render a
 * consistent set of rows regardless of how much of the stack a given
 * income actually reaches (SPEC.md §4 journey 5). Kept as the single
 * source of truth for the band-stacking arithmetic; `applyIncomeTaxBands`
 * is just this summed, so the two can never drift apart (§9.3).
 */
export function breakdownIncomeTaxByBand(taxableIncome: Pence, bands: readonly IncomeTaxBand[]): readonly IncomeTaxBandBreakdown[] {
  let bandFloor = zeroPence();

  return bands.map((band) => {
    const bandCeiling = band.upTo === null ? taxableIncome : minPence(band.upTo, taxableIncome);
    const taxableAmount = maxPence(subtractPence(bandCeiling, bandFloor), zeroPence());
    const tax = multiplyPenceByRate(taxableAmount, band.rate);

    if (band.upTo !== null) {
      bandFloor = band.upTo;
    }

    return { name: band.name, rate: band.rate, taxableAmount, tax };
  });
}

/**
 * Applies a stack of marginal-rate bands to taxable income and returns
 * the tax due (SPEC.md §5.2, §9.3).
 *
 * `bands` must cover the *full* range of taxable income, including the
 * Personal Allowance as an explicit `{ rate: 0 }` band at the bottom —
 * this function does no special-casing of the allowance itself; building
 * that combined band list (tapered allowance + the fixed rate bands from
 * a TaxYearRuleSet) is the caller's job, kept deliberately separate from
 * `taperPersonalAllowance` below so each function has one job and one
 * set of edge cases to test (§9.3).
 */
export function applyIncomeTaxBands(taxableIncome: Pence, bands: readonly IncomeTaxBand[]): Pence {
  return breakdownIncomeTaxByBand(taxableIncome, bands).reduce((total, b) => addPence(total, b.tax), zeroPence());
}

/**
 * Tapers the Personal Allowance: reduced by £1 for every £2 of adjusted
 * net income above the taper threshold, down to £0 (SPEC.md §5.2).
 *
 * Deliberately independent of `applyIncomeTaxBands` (§9.3) — the taper
 * has its own edge cases (a taper reaching exactly £0, income exactly at
 * the threshold) worth testing without involving band-stacking at all.
 */
export function taperPersonalAllowance(
  adjustedNetIncome: Pence,
  standardAllowance: Pence,
  taperThreshold: Pence,
  taperRate: number,
): Pence {
  if (adjustedNetIncome <= taperThreshold) {
    return standardAllowance;
  }

  const excessIncome = subtractPence(adjustedNetIncome, taperThreshold);
  const reduction = multiplyPenceByRate(excessIncome, taperRate);
  const taperedAllowance = subtractPence(standardAllowance, reduction);

  return maxPence(taperedAllowance, zeroPence());
}

/**
 * Builds the full band list `applyIncomeTaxBands` expects, by prepending
 * the (already-tapered) Personal Allowance as an explicit 0%-rate band
 * ahead of the standard rate bands. A small, separately-testable
 * composition step (§9.3) — not folded into either function above.
 */
export function buildFullBandStack(
  taperedPersonalAllowance: Pence,
  standardBands: readonly IncomeTaxBand[],
): readonly IncomeTaxBand[] {
  return [{ name: "personalAllowance", upTo: taperedPersonalAllowance, rate: 0 }, ...standardBands];
}

/** How much of one band is still unused, after `taxableIncomeAlreadyUsed` of it has already been taxed elsewhere this year. */
export interface RemainingBandHeadroom {
  readonly name: string;
  readonly rate: number;
  /** `null` for the unbounded top band. */
  readonly remainingWidth: Pence | null;
}

/**
 * How much headroom is left in each band of a full band stack, after
 * `taxableIncomeAlreadyUsed` of *other* income (e.g. a salary) has
 * already consumed some of it this year — the drawdown solver (SPEC.md
 * §5.7.3) needs this to know which marginal rate the *next* pound of
 * drawdown income lands in, without re-deriving band-stacking logic
 * itself. Kept separate from `applyIncomeTaxBands` (§9.3): that function
 * computes tax on a given amount; this one computes remaining capacity.
 */
export function computeRemainingBandHeadroom(
  bands: readonly IncomeTaxBand[],
  taxableIncomeAlreadyUsed: Pence,
): readonly RemainingBandHeadroom[] {
  let bandFloor = zeroPence();

  return bands.map((band) => {
    const bandCeiling = band.upTo;

    if (bandCeiling === null) {
      return { name: band.name, rate: band.rate, remainingWidth: null };
    }

    const bandWidth = subtractPence(bandCeiling, bandFloor);
    const usedInThisBand = minPence(maxPence(subtractPence(taxableIncomeAlreadyUsed, bandFloor), zeroPence()), bandWidth);
    const remainingWidth = maxPence(subtractPence(bandWidth, usedInThisBand), zeroPence());
    bandFloor = bandCeiling;

    return { name: band.name, rate: band.rate, remainingWidth };
  });
}
