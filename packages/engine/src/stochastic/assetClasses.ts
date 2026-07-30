import { HISTORICAL_RETURNS } from "./historicalReturns/data.js";
import { US_EQUITY_RETURNS } from "./historicalReturns/usEquityReturns.js";

/**
 * The four asset classes a stochastic-eligible account's `AssetAllocation`
 * blends between (schema/types.ts). US and UK equities are tracked
 * separately — genuinely distinct real markets in the bundled historical
 * dataset (`historicalReturns/data.ts`), not one blended "equities"
 * figure — see SPEC.md's "Stochastic projections" section for the scope
 * rationale.
 */
export type AssetClass = "usEquities" | "ukEquities" | "bonds" | "cash";

const ASSET_CLASSES: readonly AssetClass[] = ["usEquities", "ukEquities", "bonds", "cash"];

export interface AssetClassPreset {
  /** Arithmetic-mean real annual return. Monte Carlo mode's actual mean is a scenario's own inflation rate, not a fixed constant — see `monteCarloPresetsWithInflationMean`. */
  readonly meanReturn: number;
  /** Standard deviation of the real annual return. */
  readonly volatility: number;
  /**
   * Student's t degrees of freedom for this asset class's shock
   * distribution — `undefined` means a plain Gaussian shock (no fat-tail
   * adjustment). Lower values mean fatter tails; must stay above 2 for the
   * distribution to have finite variance. See
   * `MONTE_CARLO_DEFAULT_PRESETS`'s doc comment for how (and whether) this
   * is derived per asset class, and why it's `undefined` for equities.
   */
  readonly degreesOfFreedom?: number;
}

/**
 * How many consecutive years one historical-bootstrap draw
 * (`sampleReturns.ts`'s `sampleHistoricalTrajectory`) covers before a
 * fresh one is drawn — long enough to preserve multi-year trends (a
 * recession-recovery cycle, a "lost decade"), short enough that a
 * `years`-length trajectory still draws from several different historical
 * periods. Expressed in years for readability, even though the underlying
 * dataset (and the block itself) is monthly — `sampleHistoricalTrajectory`
 * converts this to `STOCHASTIC_BLOCK_LENGTH * 12` months internally, and
 * (deliberately) doesn't require the block to start on a calendar-year
 * boundary, which is what makes the monthly grain useful: with a 12-month
 * multiple block length, every draw still divides evenly into whole
 * "years" for `runProjection`'s per-year `growthRateOverrides`, but the
 * block's *start* can land on any of the dataset's ~440 months rather than
 * only its ~36 calendar-year starts — far more distinct historical
 * sequences to resample from. Monte Carlo mode deliberately does **not**
 * use this: it's a pure per-year random walk with no block structure (see
 * `sampleMonteCarloTrajectory`'s doc comment) — this constant exists for
 * Historical bootstrap alone.
 */
export const STOCHASTIC_BLOCK_LENGTH = 10;

function sampleVolatility(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return Math.sqrt(variance);
}

/** Excess kurtosis (0 for a Gaussian; positive = fatter tails, negative = thinner) of the sample. */
function sampleExcessKurtosis(values: readonly number[]): number {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  const fourthMoment = values.reduce((a, b) => a + (b - mean) ** 4, 0) / values.length;
  return fourthMoment / variance ** 2 - 3;
}

/**
 * The degrees of freedom of the Student's t distribution whose theoretical
 * excess kurtosis equals `excessKurtosis` (that relationship is
 * `excessKurtosis = 6 / (nu - 4)` for `nu > 4`, so `nu = 6 / excessKurtosis
 * + 4`). Returns `undefined` — "just use a Gaussian, no fat-tail
 * adjustment" — whenever the sample doesn't actually support one: a
 * negative (or negligibly small) excess kurtosis can't be represented by a
 * Student's t at all (its kurtosis is never below a Gaussian's), and a
 * few-decade sample's 4th-moment estimate is noisy enough that a small
 * positive reading isn't good evidence of real fat tails either. Also
 * floors the result at 5, defensively, in case a future dataset update
 * produces an implausibly low value the standardization step
 * (`sampleReturns.ts`) would handle poorly close to its `nu > 2` validity
 * boundary.
 */
function impliedDegreesOfFreedom(excessKurtosis: number): number | undefined {
  const MIN_EXCESS_KURTOSIS_TO_ADJUST = 0.5;
  if (excessKurtosis < MIN_EXCESS_KURTOSIS_TO_ADJUST) return undefined;
  return Math.max(5, 6 / excessKurtosis + 4);
}

/**
 * Compounds a bundled monthly dataset into one real annual return per
 * *complete* calendar year (Jan-Dec) for `key` — Monte Carlo mode's
 * presets describe a single year's return distribution, so they're built
 * from actual annual figures, not raw monthly ones. Each dataset's first
 * and last calendar years are partial (the bundled tables don't all start
 * in January or end in December) and excluded, so this isn't
 * apples-to-oranges against the genuinely complete years in between.
 * Generic over the row shape since `usEquities` is sourced from a
 * separate, longer-running table than `ukEquities`/`bonds`/`cash`
 * (`historicalReturns/usEquityReturns.ts`'s doc comment explains why).
 */
function annualizedReturns<K extends string>(key: K, months: readonly ({ readonly year: number } & Record<K, number>)[]): readonly number[] {
  const byYear = new Map<number, (typeof months)[number][]>();
  for (const row of months) {
    const forYear = byYear.get(row.year) ?? [];
    forYear.push(row);
    byYear.set(row.year, forYear);
  }
  const annual: number[] = [];
  for (const rows of byYear.values()) {
    if (rows.length !== 12) continue;
    annual.push(rows.reduce((product, row) => product * (1 + row[key]), 1) - 1);
  }
  return annual;
}

/**
 * Bare (mean, volatility, degrees of freedom) triple per asset class for
 * Monte Carlo mode, used only as a fallback when no scenario (and
 * therefore no inflation rate) is available — direct/test usage of
 * `sampleMonteCarloTrajectory` without an explicit preset. Production runs
 * (`runStochasticBatch.ts`) instead call `monteCarloPresetsWithInflationMean`
 * below, which is what actually determines a real scenario's Monte Carlo
 * mean.
 *
 * Volatility and degrees-of-freedom are both the real, sourced figures —
 * standard deviation and (where the data supports it) implied Student's t
 * shape of the bundled dataset's own complete-calendar-year annual
 * returns, not independently hand-picked numbers. Equities (both US and
 * UK) get no fat-tail adjustment (`degreesOfFreedom: undefined`) whenever
 * their measured excess kurtosis on this dataset doesn't clear the
 * adjustment threshold; bonds and cash are evaluated the same way — see
 * `impliedDegreesOfFreedom`'s doc comment for why a small or negative
 * reading is treated as "no real evidence of fat tails" rather than
 * adjusted for. Computed once at module load.
 */
function presetFrom(values: readonly number[]): AssetClassPreset {
  const degreesOfFreedom = impliedDegreesOfFreedom(sampleExcessKurtosis(values));
  return {
    meanReturn: 0,
    volatility: sampleVolatility(values),
    ...(degreesOfFreedom !== undefined ? { degreesOfFreedom } : {}),
  };
}

export const MONTE_CARLO_DEFAULT_PRESETS: Record<AssetClass, AssetClassPreset> = {
  usEquities: presetFrom(annualizedReturns("usEquities", US_EQUITY_RETURNS)),
  ukEquities: presetFrom(annualizedReturns("ukEquities", HISTORICAL_RETURNS)),
  bonds: presetFrom(annualizedReturns("bonds", HISTORICAL_RETURNS)),
  cash: presetFrom(annualizedReturns("cash", HISTORICAL_RETURNS)),
};

/**
 * `MONTE_CARLO_DEFAULT_PRESETS`, but with every asset class's mean set to
 * `mean` instead of 0. Volatility and degrees-of-freedom are untouched —
 * only the central tendency shifts, per asset class equally.
 *
 * The caller (`runStochasticBatch.ts`) passes each stochastic-eligible
 * account's own `annualGrowthRate` here, per account, so that account's
 * Monte Carlo mean matches the exact same base rate the deterministic
 * projection uses for that account (before the pension-charge deduction,
 * which both paths apply identically in `runProjection.ts` step 7) —
 * rather than a single scenario-wide figure unrelated to what the user
 * actually set per account. An earlier version pinned this to the
 * scenario's inflation rate instead, uniformly across every account;
 * reverted per product decision, so the deterministic line and Monte
 * Carlo's median start from the same assumption instead of two unrelated
 * ones. Every rate in this engine is a *real* rate (`schema/types.ts`'s
 * `AccountBase.annualGrowthRate` doc comment), so nothing here is
 * double-counting inflation regardless of which number is passed in.
 */
export function monteCarloPresetsWithMean(mean: number): Record<AssetClass, AssetClassPreset> {
  return Object.fromEntries(ASSET_CLASSES.map((ac) => [ac, { ...MONTE_CARLO_DEFAULT_PRESETS[ac], meanReturn: mean }])) as Record<
    AssetClass,
    AssetClassPreset
  >;
}
