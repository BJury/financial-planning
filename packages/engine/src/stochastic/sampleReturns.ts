import type { AssetClass, AssetClassPreset } from "./assetClasses.js";
import { MONTE_CARLO_DEFAULT_PRESETS, STOCHASTIC_BLOCK_LENGTH } from "./assetClasses.js";
import { listHistoricalReturns, listUsEquityReturns } from "./historicalReturns/registry.js";
import type { HistoricalReturnMonth, UsEquityReturnMonth } from "./historicalReturns/types.js";

/** A deterministic-given-its-seed pseudo-random source, returning values in `[0, 1)`. */
export type Prng = () => number;

/**
 * mulberry32 — a small, fast, seedable PRNG. Not cryptographic (doesn't
 * need to be); chosen over `Math.random()` so a run count/method/seed
 * combination is reproducible, which both the statistical tests below and
 * a future "share this exact simulation" feature depend on.
 */
export function createPrng(seed: number): Prng {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function sampleStandardNormal(prng: Prng): number {
  // Box-Muller transform. `u` excludes 0 to avoid `Math.log(0)`.
  let u = 0;
  while (u === 0) u = prng();
  const v = prng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * A standardized (mean 0, variance 1) draw from a Student's t distribution
 * with `degreesOfFreedom` — fatter-tailed than a standard normal for any
 * finite value, converging to one as `degreesOfFreedom` grows. Built as
 * `Z / sqrt(chiSquared / nu)` (the standard construction of a t-variate
 * from an independent normal and chi-squared draw), with `chiSquared`
 * itself built as a sum of `round(nu)` squared standard normals — chi-
 * squared with integer degrees of freedom, reusing the same normal sampler
 * above rather than a general-shape Gamma sampler, since `nu` here is
 * already only an approximate figure implied by a noisy small-sample
 * kurtosis estimate (see `assetClasses.ts`'s `impliedDegreesOfFreedom`) —
 * rounding it away doesn't meaningfully discard precision that was real to
 * begin with. Un-standardized `t` has variance `nu / (nu - 2)`, so
 * multiplying by `sqrt((nu - 2) / nu)` rescales it to unit variance,
 * matching what a standard normal would contribute in the same slot.
 */
function sampleStandardizedT(prng: Prng, degreesOfFreedom: number): number {
  const nu = Math.max(3, Math.round(degreesOfFreedom));
  const z = sampleStandardNormal(prng);
  let chiSquared = 0;
  for (let i = 0; i < nu; i++) {
    const zi = sampleStandardNormal(prng);
    chiSquared += zi * zi;
  }
  const t = z / Math.sqrt(chiSquared / nu);
  return t * Math.sqrt((nu - 2) / nu);
}

/** A standard normal shock, or a standardized Student's t one if `degreesOfFreedom` is set — see that field's doc comment on `AssetClassPreset`. */
function sampleShock(prng: Prng, degreesOfFreedom: number | undefined): number {
  return degreesOfFreedom === undefined ? sampleStandardNormal(prng) : sampleStandardizedT(prng, degreesOfFreedom);
}

/**
 * Converts an arithmetic (mean, stdev) pair into the (mu, sigma)
 * parameters of the lognormal distribution for `1 + return` that
 * reproduces them, so `sampleLognormalReturn` below can be configured in
 * the units a user actually understands ("5% average, 17% volatility")
 * rather than raw lognormal parameters.
 */
function lognormalParams(meanReturn: number, volatility: number): { readonly mu: number; readonly sigma: number } {
  const m = 1 + meanReturn;
  const sigma2 = Math.log(1 + (volatility / m) ** 2);
  return { mu: Math.log(m) - sigma2 / 2, sigma: Math.sqrt(sigma2) };
}

export function sampleLognormalReturn(prng: Prng, preset: AssetClassPreset): number {
  const { mu, sigma } = lognormalParams(preset.meanReturn, preset.volatility);
  return Math.exp(mu + sigma * sampleShock(prng, preset.degreesOfFreedom)) - 1;
}

const ASSET_CLASSES: readonly AssetClass[] = ["usEquities", "ukEquities", "bonds", "cash"];
const UK_ASSET_CLASSES = ["ukEquities", "bonds", "cash"] as const;

function emptyTrajectory(): Record<AssetClass, number[]> {
  return { usEquities: [], ukEquities: [], bonds: [], cash: [] };
}

/**
 * Circular moving-block bootstrap over *months*, for a single asset
 * class's own table: repeatedly picks a random start month (not
 * necessarily a calendar-year boundary) and takes `blockLengthMonths`
 * consecutive months (wrapping around the end of the dataset), compounding
 * every run of 12 months into one real annual return, until `years`
 * annual entries exist. Since `blockLengthMonths` is always itself a
 * multiple of 12, each block boundary lands exactly on a 12-month
 * compounding boundary too — no partial year ever gets spliced from two
 * unrelated random blocks.
 */
function bootstrapSingleClass<K extends string>(
  years: number,
  prng: Prng,
  history: readonly ({ readonly year: number } & Record<K, number>)[],
  key: K,
  blockLengthMonths: number,
): number[] {
  const result: number[] = [];
  let monthsInYear: number[] = [];
  while (result.length < years) {
    const startIndex = Math.floor(prng() * history.length);
    for (let offset = 0; offset < blockLengthMonths && result.length < years; offset++) {
      const row = history[(startIndex + offset) % history.length];
      if (!row) continue;
      monthsInYear.push(row[key]);
      if (monthsInYear.length === 12) {
        result.push(monthsInYear.reduce((product, r) => product * (1 + r), 1) - 1);
        monthsInYear = [];
      }
    }
  }
  return result;
}

/**
 * Same moving-block-over-months mechanics as `bootstrapSingleClass`, but
 * for `ukEquities`/`bonds`/`cash` together — the same drawn historical
 * month supplies all three, preserving real cross-asset correlation (e.g.
 * 2022's simultaneous equity and bond real-return loss).
 */
function bootstrapUkClasses(
  years: number,
  prng: Prng,
  history: readonly HistoricalReturnMonth[],
  blockLengthMonths: number,
): { readonly ukEquities: number[]; readonly bonds: number[]; readonly cash: number[] } {
  const result = { ukEquities: [] as number[], bonds: [] as number[], cash: [] as number[] };
  let monthsInYear = { ukEquities: [] as number[], bonds: [] as number[], cash: [] as number[] };
  while (result.ukEquities.length < years) {
    const startIndex = Math.floor(prng() * history.length);
    for (let offset = 0; offset < blockLengthMonths && result.ukEquities.length < years; offset++) {
      const row = history[(startIndex + offset) % history.length];
      if (!row) continue;
      for (const assetClass of UK_ASSET_CLASSES) monthsInYear[assetClass].push(row[assetClass]);

      if (monthsInYear.ukEquities.length === 12) {
        for (const assetClass of UK_ASSET_CLASSES) {
          result[assetClass].push(monthsInYear[assetClass].reduce((product, r) => product * (1 + r), 1) - 1);
        }
        monthsInYear = { ukEquities: [], bonds: [], cash: [] };
      }
    }
  }
  return result;
}

/**
 * `usEquities` is drawn independently from its own, much longer-running
 * table (`historicalReturns/usEquityReturns.ts`), uncorrelated with that
 * same run's `ukEquities`/`bonds`/`cash` draw — those three still share
 * one drawn historical month each, preserving their own real cross-asset
 * correlation, exactly as before. See `usEquityReturns.ts`'s doc comment
 * for why the two tables don't share one window rather than being forced
 * onto a common (and much shorter) one.
 *
 * A pure-random reference implementation, directly tested below — kept as
 * a self-contained utility and the API earlier versions of this feature
 * used throughout. `runStochasticBatch.ts`'s production historical
 * bootstrap no longer calls this for `usEquities` specifically: it walks
 * every real historical window exhaustively instead of drawing random
 * ones (`walkUsEquityWindows` below), while still drawing
 * `ukEquities`/`bonds`/`cash` randomly via `sampleUkTrajectory` (the same
 * logic this function also uses for those three).
 */
export function sampleHistoricalTrajectory(
  years: number,
  prng: Prng,
  history: readonly HistoricalReturnMonth[] = listHistoricalReturns(),
  usHistory: readonly UsEquityReturnMonth[] = listUsEquityReturns(),
  blockLengthYears: number = STOCHASTIC_BLOCK_LENGTH,
): Record<AssetClass, number[]> {
  const blockLengthMonths = blockLengthYears * 12;
  const usEquities = bootstrapSingleClass(years, prng, usHistory, "usEquities", blockLengthMonths);
  const { ukEquities, bonds, cash } = bootstrapUkClasses(years, prng, history, blockLengthMonths);
  return { usEquities, ukEquities, bonds, cash };
}

/** `ukEquities`/`bonds`/`cash` only (no `usEquities`) — the same random moving-block bootstrap `sampleHistoricalTrajectory` uses for these three, exposed on its own so `runStochasticBatch.ts` can pair it with `usEquities` sourced a different way (`walkUsEquityWindows`, an exhaustive walk rather than a random draw). */
export function sampleUkTrajectory(
  years: number,
  prng: Prng,
  history: readonly HistoricalReturnMonth[] = listHistoricalReturns(),
  blockLengthYears: number = STOCHASTIC_BLOCK_LENGTH,
): { readonly ukEquities: number[]; readonly bonds: number[]; readonly cash: number[] } {
  return bootstrapUkClasses(years, prng, history, blockLengthYears * 12);
}

/**
 * How many distinct, genuinely unbroken `years`-long windows exist in
 * `usHistory` — `usHistory.length - years * 12 + 1`, floored at 1 so an
 * implausibly long horizon (longer than the whole dataset) still returns
 * a usable count rather than zero or a negative number.
 */
export function countUsEquityWindows(years: number, usHistory: readonly UsEquityReturnMonth[] = listUsEquityReturns()): number {
  return Math.max(1, usHistory.length - years * 12 + 1);
}

/**
 * Every distinct real window of `years` full years (`years * 12`
 * consecutive months, in genuine historical order — never spliced from
 * two different points in time, unlike the random moving-block bootstrap)
 * available in `usHistory`, walked from the earliest possible starting
 * month to the latest, one month at a time. An exhaustive historical
 * backtest, not a random sample: every real window is used exactly once,
 * nothing skipped, nothing repeated, nothing invented — this is what
 * `runStochasticBatch.ts` uses for `usEquities` whenever any account's
 * `equityMarket` is `"us"`, in place of the random draw
 * `sampleHistoricalTrajectory` above still uses for it directly. Because
 * the result is exhaustive rather than sampled, the number of "runs" it
 * produces isn't a free choice — it's exactly `countUsEquityWindows`,
 * which `runStochasticBatch.ts` uses to override the user-chosen run
 * count for the whole batch whenever this path is active.
 *
 * If `years * 12` exceeds `usHistory.length` (an implausibly long
 * projection horizon relative to the ~109 years of bundled data), falls
 * back to a single window that wraps circularly around the dataset —
 * better than refusing to run at all, but no longer a genuinely unbroken
 * historical sequence for that one window; this is an edge case, not the
 * normal path.
 */
export function walkUsEquityWindows(years: number, usHistory: readonly UsEquityReturnMonth[] = listUsEquityReturns()): readonly number[][] {
  const windowCount = countUsEquityWindows(years, usHistory);
  const windows: number[][] = [];
  for (let start = 0; start < windowCount; start++) {
    const annual: number[] = [];
    for (let y = 0; y < years; y++) {
      let compounded = 1;
      for (let m = 0; m < 12; m++) {
        const row = usHistory[(start + y * 12 + m) % usHistory.length];
        if (row) compounded *= 1 + row.usEquities;
      }
      annual.push(compounded - 1);
    }
    windows.push(annual);
  }
  return windows;
}

/**
 * An independent-per-asset-class, per-year lognormal draw — a pure random
 * walk for the whole horizon, deliberately with no block structure: each
 * year's return is statistically unrelated to every other year's,
 * regardless of asset class or how many years the trajectory spans. An
 * earlier version of this function drew one shock per 10-year block
 * instead (matching `sampleHistoricalTrajectory`'s own cadence) to bring
 * its tail in line with the historical bootstrap's — deliberately reverted
 * per product decision: Monte Carlo mode is meant to be a pure statistical
 * random walk, not to borrow persistence structure from real history (that
 * is what Historical bootstrap mode is for). The consequence is a
 * materially wider spread of outcomes than Historical bootstrap produces
 * from the same underlying volatility figures, since compounding
 * independent per-year shocks over a 40+-year horizon is inherently
 * fatter-tailed than resampling real, persistent multi-year sequences —
 * see `MONTE_CARLO_DEFAULT_PRESETS`'s doc comment for the volatility this
 * now uses (single-year, not block-level). No cross-asset correlation
 * within a year either, unlike the historical mode.
 */
export function sampleMonteCarloTrajectory(
  years: number,
  prng: Prng,
  presets: Record<AssetClass, AssetClassPreset> = MONTE_CARLO_DEFAULT_PRESETS,
): Record<AssetClass, number[]> {
  const result = emptyTrajectory();
  for (let i = 0; i < years; i++) {
    for (const assetClass of ASSET_CLASSES) {
      result[assetClass].push(sampleLognormalReturn(prng, presets[assetClass]));
    }
  }
  return result;
}
