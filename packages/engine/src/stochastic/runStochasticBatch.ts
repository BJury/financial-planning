import { pence, type Pence } from "../money/pence.js";
import { DEFAULT_ASSET_ALLOCATION, type Account, type Scenario } from "../schema/types.js";
import type { TaxYearRuleSet } from "../taxYearData/types.js";
import { monteCarloPresetsWithMean, type AssetClass, type AssetClassPreset } from "./assetClasses.js";
import { createPrng, sampleMonteCarloTrajectory, sampleUkTrajectory, walkUsEquityWindows, type Prng } from "./sampleReturns.js";
import { isStochasticEligible, runStochasticTrajectory, type ShortfallSeverity, type StochasticTrajectorySummary } from "./runStochasticTrajectory.js";

export type { ShortfallSeverity } from "./runStochasticTrajectory.js";

export type StochasticMethod = "historical" | "montecarlo";

export interface YearPercentiles {
  readonly p10: Pence;
  readonly p15: Pence;
  readonly p25: Pence;
  readonly p50: Pence;
  readonly p75: Pence;
  readonly p85: Pence;
  readonly p90: Pence;
}

export interface FinalOutcome {
  readonly netWorth: Pence;
  /** Equivalent to `shortfallSeverity !== "none"`, kept as its own field since most callers only need the boolean. */
  readonly hadShortfall: boolean;
  readonly shortfallSeverity: ShortfallSeverity;
}

/**
 * How many individual runs' full trajectories `StochasticBatchResult.sampleTrajectories` keeps —
 * enough to give a real sense of the spread when plotted as individual lines, small enough to stay
 * cheap to carry around and render regardless of `runCount`. **Not applied** to the exhaustive
 * US-equities backtest (`walkUsEquityWindows`): that run count is already a small, fixed, meaningful
 * number (every line is a genuinely distinct real historical window, not an arbitrary subsample of a
 * much larger random batch), so all of them are kept — see `runStochasticBatch`'s own use of this
 * constant for exactly where the exception applies.
 */
export const SAMPLE_TRAJECTORY_COUNT = 100;

export interface StochasticBatchResult {
  /** One entry per simulated year, same order as the deterministic projection's rows. */
  readonly netWorthPercentilesByYear: readonly YearPercentiles[];
  /** Fraction (0-1) of runs that never hit a drawdown or living-expenses shortfall. */
  readonly successRate: number;
  readonly runCount: number;
  /**
   * End-of-plan net worth for every individual run, alongside whether that
   * run ever hit a shortfall — the raw material for a histogram of
   * outcomes (`pages/StochasticProjection.tsx`), since five percentiles
   * alone can't show whether a wide p10-p90 band is a smooth spread or a
   * lump of failed runs near zero plus a long successful tail.
   */
  readonly finalOutcomes: readonly FinalOutcome[];
  /**
   * Full per-year net worth for `min(SAMPLE_TRAJECTORY_COUNT, runCount)`
   * individual runs, spread evenly across the *outcome* distribution (see
   * `stratifiedSampleIndices`) rather than just the first N simulated — not
   * used for any statistic, purely so a caller can plot a handful of actual
   * simulated paths ("spaghetti lines") alongside the aggregated percentile
   * bands, giving an intuitive feel for what individual trajectories
   * actually look like rather than only their summary statistics. Holds
   * *every* run, not just a sample, for the exhaustive US-equities backtest
   * specifically — see `SAMPLE_TRAJECTORY_COUNT`'s doc comment.
   */
  readonly sampleTrajectories: readonly (readonly Pence[])[];
  /**
   * Per-year shortfall flags for the exact same runs as `sampleTrajectories`,
   * in the same order — `sampleShortfallYears[i][yearIndex]` is `true` if
   * that run's year had a drawdown/living-expenses shortfall, letting a
   * caller mark *which* year(s) on a plotted line actually failed, not
   * just that the run did at some point (`finalOutcomes[i].hadShortfall`
   * only carries the aggregate).
   */
  readonly sampleShortfallYears: readonly (readonly boolean[])[];
  /**
   * `finalOutcomes` index that each entry of `sampleTrajectories`/
   * `sampleShortfallYears` was drawn from. Needed because those two arrays
   * are no longer simply "the first N runs" (see `stratifiedSampleIndices`)
   * — a caller matching a set of `finalOutcomes` indices (e.g. one
   * percentile bucket's members) against the sampled subset must look up
   * each index's *position* here rather than assuming the index doubles as
   * one directly.
   */
  readonly sampledRunIndices: readonly number[];
}

export interface StochasticBatchOptions {
  readonly scenario: Scenario;
  readonly confirmedRuleSet: TaxYearRuleSet;
  readonly numberOfYears: number;
  readonly method: StochasticMethod;
  readonly runCount: number;
  /** Defaults to a time-based seed — pass an explicit value for reproducible runs (e.g. tests). */
  readonly seed?: number;
  readonly monteCarloPresets?: Record<AssetClass, AssetClassPreset>;
  /** Called after every completed run, so a caller (e.g. the web worker) can report progress without waiting for the whole batch. */
  readonly onProgress?: (completed: number, total: number) => void;
}

function percentile(sorted: readonly Pence[], p: number): Pence {
  const index = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[index] ?? pence(0);
}

function percentilesForYear(summaries: readonly StochasticTrajectorySummary[], yearIndex: number): YearPercentiles {
  const values = [...summaries.map((s) => s.netWorthByYear[yearIndex]).filter((v): v is Pence => v !== undefined)].sort((a, b) => a - b);
  return {
    p10: percentile(values, 0.1),
    p15: percentile(values, 0.15),
    p25: percentile(values, 0.25),
    p50: percentile(values, 0.5),
    p75: percentile(values, 0.75),
    p85: percentile(values, 0.85),
    p90: percentile(values, 0.9),
  };
}

/**
 * Picks `sampleCount` run indices spread evenly across the *outcome* distribution (sorted by
 * end-of-plan net worth), not the first `sampleCount` runs in simulation order — the two are
 * uncorrelated (which run happens to get simulated first has nothing to do with how it turns
 * out), so an order-based sample can easily miss whole stretches of the outcome range entirely.
 * That's invisible for a healthy plan (outcomes cluster together, so any subsample looks similar),
 * but glaring for a struggling one: `pages/StochasticProjection.tsx`'s percentile histogram can
 * show a percentile band that's 100% failures with *zero* of its runs among the saved sample —
 * purely because none of that band's (arbitrary) simulation-order positions happened to fall in
 * the first `sampleCount` — leaving the "click a bar to see its paths" feature with nothing to
 * show for that band even though plenty of matching runs exist in the full batch.
 */
function stratifiedSampleIndices(summaries: readonly StochasticTrajectorySummary[], sampleCount: number): number[] {
  const n = summaries.length;
  if (n <= sampleCount) return summaries.map((_, i) => i);
  const sortedByOutcome = [...summaries.map((s, i) => ({ i, netWorth: s.netWorthByYear.at(-1) ?? pence(0) }))].sort(
    (a, b) => a.netWorth - b.netWorth,
  );
  const picks = Array.from({ length: sampleCount }, (_, k) => sortedByOutcome[Math.floor((k * n) / sampleCount)]?.i ?? 0);
  return picks.sort((a, b) => a - b);
}

/** True if any stochastic-eligible account actually draws from the `usEquities` series (a non-zero equities weight, with `equityMarket` set to `"us"` — explicitly or via the default preset's fallback). */
function usesUsEquities(scenario: Scenario): boolean {
  return scenario.accounts.some((account) => {
    if (!isStochasticEligible(account)) return false;
    const allocation = account.assetAllocation ?? DEFAULT_ASSET_ALLOCATION;
    return allocation.equities > 0 && allocation.equityMarket === "us";
  });
}

/**
 * Runs `runStochasticTrajectory` some number of times (one sampled market
 * path per run) and aggregates the results into per-year percentile bands
 * plus an overall success rate. This is the function both the engine's
 * own tests and the web app's worker call directly (SPEC.md's
 * "Stochastic projections" section).
 *
 * That "some number of times" is `options.runCount` for Monte Carlo mode,
 * or ordinarily for Historical bootstrap too — **except** when at least
 * one account actually draws from `usEquities`, in which case the batch
 * instead runs exactly once per real historical window
 * (`walkUsEquityWindows`'s exhaustive backtest, not a random sample), and
 * `options.runCount` is ignored — see that function's doc comment for
 * why an exhaustive walk can't also be a free choice of sample size. The
 * actual count used either way is reported back as `runCount` on the
 * result, which callers should read rather than assuming it echoes
 * `options.runCount`.
 */
export function runStochasticBatch(options: StochasticBatchOptions): StochasticBatchResult {
  const prng: Prng = createPrng(options.seed ?? Date.now());
  const summaries: StochasticTrajectorySummary[] = [];

  const usWindows =
    options.method === "historical" && usesUsEquities(options.scenario) ? walkUsEquityWindows(options.numberOfYears) : null;
  const effectiveRunCount = usWindows ? usWindows.length : options.runCount;

  for (let i = 0; i < effectiveRunCount; i++) {
    const sampledReturnsForAccount: (account: Account) => Record<AssetClass, readonly number[]> =
      options.method === "historical"
        ? (() => {
            // One shared trajectory per run, handed to every account — see runStochasticTrajectory's doc comment for why Historical bootstrap (unlike Monte Carlo) needs this.
            // usEquities: an exhaustive walk through every real window when it's actually used (see this function's own doc comment), else an inert
            // all-zero placeholder — no account has a non-zero weight on it in that case, so its value can never affect a blended return.
            const usEquities = usWindows ? usWindows[i] : new Array<number>(options.numberOfYears).fill(0);
            const { ukEquities, bonds, cash } = sampleUkTrajectory(options.numberOfYears, prng);
            const sharedTrajectory: Record<AssetClass, readonly number[]> = { usEquities: usEquities ?? [], ukEquities, bonds, cash };
            return () => sharedTrajectory;
          })()
        : (account) =>
            sampleMonteCarloTrajectory(
              options.numberOfYears,
              prng,
              // Absent an explicit override, each account's own Monte Carlo mean
              // matches that account's own annualGrowthRate — the same base rate
              // the deterministic projection uses for it — rather than one
              // scenario-wide figure unrelated to what the user actually set.
              options.monteCarloPresets ?? monteCarloPresetsWithMean(account.annualGrowthRate),
            );
    summaries.push(runStochasticTrajectory(options.scenario, options.confirmedRuleSet, options.numberOfYears, sampledReturnsForAccount));
    options.onProgress?.(i + 1, effectiveRunCount);
  }

  const netWorthPercentilesByYear = Array.from({ length: options.numberOfYears }, (_, yearIndex) => percentilesForYear(summaries, yearIndex));
  const successRate = summaries.length === 0 ? 0 : summaries.filter((s) => !s.hadShortfall).length / summaries.length;
  const finalOutcomes = summaries.map((s) => ({ netWorth: s.netWorthByYear.at(-1) ?? pence(0), hadShortfall: s.hadShortfall, shortfallSeverity: s.shortfallSeverity }));
  // The exhaustive US-equities backtest keeps every trajectory (see SAMPLE_TRAJECTORY_COUNT's doc
  // comment) — its run count is already small, fixed, and meaningful, unlike an arbitrary large
  // random `runCount`. Otherwise, spread the sample evenly across the outcome distribution rather
  // than just taking the first SAMPLE_TRAJECTORY_COUNT runs simulated — see stratifiedSampleIndices.
  const sampledRunIndices = usWindows ? summaries.map((_, i) => i) : stratifiedSampleIndices(summaries, SAMPLE_TRAJECTORY_COUNT);
  const sampleTrajectories = sampledRunIndices.map((i) => summaries[i]?.netWorthByYear ?? []);
  const sampleShortfallYears = sampledRunIndices.map((i) => summaries[i]?.shortfallByYear ?? []);

  return { netWorthPercentilesByYear, successRate, runCount: effectiveRunCount, finalOutcomes, sampleTrajectories, sampleShortfallYears, sampledRunIndices };
}
