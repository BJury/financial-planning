import { isNegative, subtractPence, sumPence, zeroPence, type Pence } from "../money/pence.js";
import { runProjection } from "../simulation/runProjection.js";
import { DEFAULT_ASSET_ALLOCATION, type Account, type Scenario } from "../schema/types.js";
import { startCalendarYearOf, type TaxYearRuleSet } from "../taxYearData/types.js";
import type { AssetClass } from "./assetClasses.js";
import { annualReturnViaDailyRate, daysInTaxYear } from "./dailyRate.js";

/**
 * Account kinds/subtypes whose capital growth is randomized in stochastic
 * mode. Cash accounts and cash ISAs are excluded because their
 * `annualGrowthRate` also drives *taxed interest income* elsewhere in
 * `runProjection`, and Property/GIA-dividend-yield use separate rate
 * fields entirely — see SPEC.md's "Stochastic projections" section for
 * the full scope rationale. Exported so the "Confidence" page's own
 * "Investment mix" editor (`pages/StochasticProjection.tsx`) shows an
 * input for exactly the accounts this actually affects — one shared
 * definition, not two that could drift apart.
 */
export function isStochasticEligible(account: Account): boolean {
  if (account.kind === "pension" || account.kind === "gia") return true;
  if (account.kind === "isa") return account.isaType !== "cash";
  return false;
}

/**
 * Blends one sampled `Record<AssetClass, number[]>` against an account's
 * own `assetAllocation` (or the default preset) into a single per-year
 * rate array — the shape `runProjection`'s `growthRateOverrides` expects.
 * `equityMarket` is an either/or choice (`schema/types.ts`'s
 * `AssetAllocation` doc comment), not a blend — the account's whole
 * `equities` fraction routes to whichever of `usEquities`/`ukEquities`
 * it names, the other gets zero weight.
 */
function blendAllocation(sampledReturns: Record<AssetClass, readonly number[]>, allocation: Account["assetAllocation"]): number[] {
  const { equities, equityMarket, bonds, cash } = allocation ?? DEFAULT_ASSET_ALLOCATION;
  const usEquities = equityMarket === "us" ? equities : 0;
  const ukEquities = equityMarket === "uk" ? equities : 0;
  const years = sampledReturns.usEquities.length;
  const blended: number[] = [];
  for (let i = 0; i < years; i++) {
    blended.push(
      usEquities * (sampledReturns.usEquities[i] ?? 0) +
        ukEquities * (sampledReturns.ukEquities[i] ?? 0) +
        bonds * (sampledReturns.bonds[i] ?? 0) +
        cash * (sampledReturns.cash[i] ?? 0),
    );
  }
  return blended;
}

/**
 * A shortfall (a year's drawdown/living-expenses target not fully met)
 * doesn't necessarily mean the person was actually poor that year — it
 * can just mean the money that existed wasn't *accessible* (e.g. still
 * locked in a pension before minimum access age), while overall net
 * worth stayed positive. `"recoverable"` captures that case; `"depleted"`
 * is the more serious one, where net worth itself was already zero or
 * negative when the shortfall happened — genuinely out of money, not
 * just unable to reach money that still exists elsewhere.
 */
export type ShortfallSeverity = "none" | "recoverable" | "depleted";

export interface StochasticTrajectorySummary {
  /** Net worth (SPEC.md §7) at the end of each simulated year, in the same order as the deterministic projection's rows. */
  readonly netWorthByYear: readonly Pence[];
  /** True if any person hit a drawdown or living-expenses shortfall in any year of this run — this trajectory's plan didn't hold up. Equivalent to `shortfallSeverity !== "none"`. */
  readonly hadShortfall: boolean;
  /** Per-year version of `hadShortfall` — true for each year any person hit a drawdown or living-expenses shortfall that specific year, same order as `netWorthByYear`. `hadShortfall` is just `shortfallByYear.some(Boolean)`, kept as its own field since it's what most callers actually need. */
  readonly shortfallByYear: readonly boolean[];
  /**
   * This run's worst shortfall, if any — `"depleted"` if *any* shortfall
   * year's net worth was already zero/negative, `"recoverable"` if every
   * shortfall year still had positive net worth sitting somewhere
   * (just not accessible that year), `"none"` if `shortfallByYear` never
   * fired at all. A single run can have both kinds across different
   * years; this takes the worse of the two, matching how `hadShortfall`
   * already takes "did it happen at all" rather than "did it happen
   * every year."
   */
  readonly shortfallSeverity: ShortfallSeverity;
}

/**
 * Runs the existing deterministic engine once, but with each
 * stochastic-eligible account's growth substituted year-by-year from
 * `sampledReturnsForAccount(account)`, then reduces the full result down to
 * just what the batch runner needs — keeping thousands of trajectories
 * cheap to hold in memory at once.
 *
 * Takes a function rather than one shared `Record<AssetClass, number[]>`
 * because the two sampling methods disagree on whether accounts should
 * share a draw: Historical bootstrap mode draws *one* real historical
 * trajectory per run and hands the same one to every account (preserving
 * real cross-account/cross-asset correlation — two equity-heavy accounts
 * should feel the same market year), whereas Monte Carlo mode draws a
 * fresh trajectory *per account*, centred on that account's own
 * `annualGrowthRate` (`runStochasticBatch.ts`) rather than one scenario-wide
 * figure — so different accounts, with different assumed growth rates,
 * need genuinely different draws, at the cost of no longer sharing a
 * single "this is what the market did this year" path across accounts.
 */
export function runStochasticTrajectory(
  scenario: Scenario,
  confirmedRuleSet: TaxYearRuleSet,
  numberOfYears: number,
  sampledReturnsForAccount: (account: Account) => Record<AssetClass, readonly number[]>,
): StochasticTrajectorySummary {
  // Each blended year's return is routed through an explicit daily rate
  // (see dailyRate.ts) rather than applied as a single annual figure
  // directly — the simulation now genuinely generates a return per day,
  // for the exact number of days in that specific tax year (365 or 366),
  // not just a per-year lump.
  const startCalendarYear = startCalendarYearOf(confirmedRuleSet);
  const growthRateOverrides = new Map<string, readonly number[]>(
    scenario.accounts.filter(isStochasticEligible).map((account) => [
      account.id,
      blendAllocation(sampledReturnsForAccount(account), account.assetAllocation).map((rate, yearIndex) =>
        annualReturnViaDailyRate(rate, daysInTaxYear(startCalendarYear + yearIndex)),
      ),
    ]),
  );

  const result = runProjection(scenario, confirmedRuleSet, numberOfYears, growthRateOverrides);

  const netWorthByYear = result.rows.map((row) =>
    subtractPence(sumPence([...row.accountBalances.values()]), sumPence([...row.mortgageBalanceByPropertyId.values()])),
  );
  const shortfallByYear = result.rows.map((row) => row.perPerson.some((p) => p.drawdownShortfall || p.livingExpensesShortfall));
  const hadShortfall = shortfallByYear.some(Boolean);
  const isDepletedThatYear = (netWorth: Pence) => isNegative(netWorth) || netWorth === zeroPence();
  const shortfallSeverity: ShortfallSeverity = shortfallByYear.some((shortfall, y) => shortfall && isDepletedThatYear(netWorthByYear[y] ?? zeroPence()))
    ? "depleted"
    : hadShortfall
      ? "recoverable"
      : "none";

  return { netWorthByYear, hadShortfall, shortfallByYear, shortfallSeverity };
}
