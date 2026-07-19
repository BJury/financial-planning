import { addPence, maxPence, minPence, subtractPence, zeroPence, type Pence } from "../money/pence.js";
import type { CapitalGainsRates } from "../tax/capitalGainsTax.js";
import { solveDrawdown, type DrawdownBucketAmount, type DrawdownSolverInputs, type DrawdownSolverResult } from "./solveDrawdown.js";

/**
 * One person's account state/tax position for the household solver — the
 * same shape `DrawdownSolverInputs` needs, minus the target and the
 * taxable/non-taxable preference (the household solver decides each
 * person's own target *and* their proportional share of the household's
 * one combined preference figure, the same way it already decides their
 * target).
 */
export type HouseholdDrawdownPersonState = Omit<DrawdownSolverInputs, "targetNetAmount" | "capitalGainsRates" | "taxablePreferenceAmount">;

export interface HouseholdDrawdownPerson<TId> {
  readonly id: TId;
  readonly state: HouseholdDrawdownPersonState;
}

/**
 * How a combined household target is divided between the two people
 * (SPEC.md §5.7.4, §4 journey 6) — always offered alongside `"even"` and
 * `"custom"` so the tax saving from `"optimised"` is visible and
 * explicable, never a hidden black-box result.
 */
export type HouseholdDrawdownStrategy =
  | { readonly kind: "optimised" }
  | { readonly kind: "even" }
  | { readonly kind: "custom"; readonly firstPersonShare: number };

export interface HouseholdDrawdownPersonResult<TId> {
  readonly id: TId;
  readonly result: DrawdownSolverResult;
}

export interface HouseholdDrawdownSolverResult<TId> {
  readonly perPerson: readonly HouseholdDrawdownPersonResult<TId>[];
  readonly totalNetAchieved: Pence;
  readonly totalTaxCost: Pence;
  readonly shortfall: boolean;
}

function applyResultToState(state: HouseholdDrawdownPersonState, result: DrawdownSolverResult): HouseholdDrawdownPersonState {
  const returnOfCapital = result.buckets.find((b) => b.bucket === "taxFreeGIAReturnOfCapital")?.amount ?? zeroPence();
  return {
    ...state,
    pensionBalance: subtractPence(state.pensionBalance, result.pensionGrossWithdrawn),
    isaBalance: subtractPence(state.isaBalance, result.isaGrossWithdrawn),
    cashBalance: subtractPence(state.cashBalance, result.cashGrossWithdrawn),
    giaBalance: subtractPence(state.giaBalance, result.giaGrossWithdrawn),
    giaCostBasis: subtractPence(state.giaCostBasis, returnOfCapital),
    lumpSumAllowanceRemaining: subtractPence(state.lumpSumAllowanceRemaining, result.lumpSumAllowanceUsed),
    capitalGainsExemptAmountRemaining: subtractPence(state.capitalGainsExemptAmountRemaining, result.capitalGainsExemptAmountUsed),
  };
}

/** Sums two sequential draws from the same person into their one true total for the year (SPEC.md §9.3: each call stays pure, the composition is just addition). */
function mergeDrawdownResults(a: DrawdownSolverResult, b: DrawdownSolverResult): DrawdownSolverResult {
  const bucketTotals = new Map<string, DrawdownBucketAmount>();
  for (const bucket of [...a.buckets, ...b.buckets]) {
    const existing = bucketTotals.get(bucket.bucket);
    bucketTotals.set(bucket.bucket, {
      bucket: bucket.bucket,
      taxCategory: bucket.taxCategory,
      amount: addPence(existing?.amount ?? zeroPence(), bucket.amount),
      taxCost: addPence(existing?.taxCost ?? zeroPence(), bucket.taxCost),
    });
  }
  return {
    buckets: [...bucketTotals.values()],
    pensionGrossWithdrawn: addPence(a.pensionGrossWithdrawn, b.pensionGrossWithdrawn),
    isaGrossWithdrawn: addPence(a.isaGrossWithdrawn, b.isaGrossWithdrawn),
    cashGrossWithdrawn: addPence(a.cashGrossWithdrawn, b.cashGrossWithdrawn),
    giaGrossWithdrawn: addPence(a.giaGrossWithdrawn, b.giaGrossWithdrawn),
    lumpSumAllowanceUsed: addPence(a.lumpSumAllowanceUsed, b.lumpSumAllowanceUsed),
    capitalGainsExemptAmountUsed: addPence(a.capitalGainsExemptAmountUsed, b.capitalGainsExemptAmountUsed),
    incomeTaxCost: addPence(a.incomeTaxCost, b.incomeTaxCost),
    capitalGainsTaxCost: addPence(a.capitalGainsTaxCost, b.capitalGainsTaxCost),
    netAchieved: addPence(a.netAchieved, b.netAchieved),
    shortfall: b.shortfall,
  };
}

const EMPTY_RESULT: DrawdownSolverResult = {
  buckets: [],
  pensionGrossWithdrawn: zeroPence(),
  isaGrossWithdrawn: zeroPence(),
  cashGrossWithdrawn: zeroPence(),
  giaGrossWithdrawn: zeroPence(),
  lumpSumAllowanceUsed: zeroPence(),
  capitalGainsExemptAmountUsed: zeroPence(),
  incomeTaxCost: zeroPence(),
  capitalGainsTaxCost: zeroPence(),
  netAchieved: zeroPence(),
  shortfall: false,
};

/** How much of a solve's net achieved came entirely tax-free (SPEC.md §5.7.3's free tier) — pension-within-PA counts too, since its marginal rate there is 0%. */
function freeCapacityDrawn(result: DrawdownSolverResult): Pence {
  return result.buckets.filter((b) => b.taxCost === 0).reduce((total, b) => addPence(total, b.amount), zeroPence());
}

/** Total tax cost per net pound achieved — lower is cheaper; a solve that achieved nothing is never preferred over one that achieved something. */
function costPerNetPound(result: DrawdownSolverResult): number {
  if (result.netAchieved <= 0) return Number.POSITIVE_INFINITY;
  return (result.incomeTaxCost + result.capitalGainsTaxCost) / result.netAchieved;
}

function solveEvenOrCustom<TId>(
  target: Pence,
  people: readonly [HouseholdDrawdownPerson<TId>, HouseholdDrawdownPerson<TId>],
  share: number,
  capitalGainsRates: CapitalGainsRates,
  taxablePreferenceAmount: Pence | undefined,
): HouseholdDrawdownSolverResult<TId> {
  const [personA, personB] = people;
  // Person B gets the exact remainder (never independently rounded), so
  // the two targets always sum back to `target` — this engine's usual
  // exact-by-construction split pattern (e.g. `splitByOwnership`). The
  // household's one combined taxable/non-taxable preference figure (if
  // any) is split the same way, by the same `share` — each person's
  // proportional slice of it, matching their own proportional slice of
  // the target.
  const targetA = Math.round(target * share) as Pence;
  const targetB = subtractPence(target, targetA);
  const preferenceA = taxablePreferenceAmount === undefined ? undefined : (Math.round(taxablePreferenceAmount * share) as Pence);
  const preferenceB = taxablePreferenceAmount === undefined ? undefined : subtractPence(taxablePreferenceAmount, preferenceA ?? zeroPence());
  const resultA = solveDrawdown({
    ...personA.state,
    targetNetAmount: targetA,
    capitalGainsRates,
    ...(preferenceA !== undefined ? { taxablePreferenceAmount: preferenceA } : {}),
  });
  const resultB = solveDrawdown({
    ...personB.state,
    targetNetAmount: targetB,
    capitalGainsRates,
    ...(preferenceB !== undefined ? { taxablePreferenceAmount: preferenceB } : {}),
  });
  return combine([
    { id: personA.id, result: resultA },
    { id: personB.id, result: resultB },
  ]);
}

function combine<TId>(perPerson: readonly HouseholdDrawdownPersonResult<TId>[]): HouseholdDrawdownSolverResult<TId> {
  return {
    perPerson,
    totalNetAchieved: perPerson.reduce((total, p) => addPence(total, p.result.netAchieved), zeroPence()),
    totalTaxCost: perPerson.reduce((total, p) => addPence(total, addPence(p.result.incomeTaxCost, p.result.capitalGainsTaxCost)), zeroPence()),
    shortfall: perPerson.some((p) => p.result.shortfall),
  };
}

/**
 * Household drawdown optimisation (SPEC.md §5.7.4) — for a combined
 * household target, *which* person draws *which* bucket first is part of
 * the optimisation, since Personal Allowance/band headroom/allowances
 * are all per-person. `"optimised"` runs in two phases:
 *
 * 1. **Free tier for both people first** (0% cost — PA-band pension via
 *    UFPLS, ISA, cash, GIA-within-AEA) — order between people doesn't
 *    matter here, since it's equally free either way.
 * 2. For any remainder, **whichever person's solo cost-per-net-pound to
 *    cover it is cheaper draws first** (e.g. the lower earner's unused
 *    Personal Allowance/basic-rate headroom usually wins), then any
 *    still-unmet remainder falls to the other person.
 *
 * This is a deliberate simplification of a fully interleaved,
 * penny-by-penny cross-person merge (which band of which person is
 * cheapest at every single increment) — the single up-front
 * cheaper-person comparison after the free tier captures the common,
 * high-value case (SPEC.md's own example: routing income through the
 * non-earning spouse's otherwise-wasted allowance) without the
 * complexity of a full merge, mirroring how the per-person solver itself
 * is already documented as "not perfectly optimal in every edge case."
 *
 * A single-person "household" (e.g. before a second Person exists) just
 * delegates straight to `solveDrawdown`.
 */
export function solveHouseholdDrawdown<TId>(
  targetNetAmount: Pence,
  strategy: HouseholdDrawdownStrategy,
  people: readonly HouseholdDrawdownPerson<TId>[],
  capitalGainsRates: CapitalGainsRates,
  /**
   * Optional — the household's one combined taxable/non-taxable
   * preference figure (`catalog/incomeSources/targetDrawdownIncome.ts`'s
   * `taxableDrawdownPreference` field, for a joint target). Split
   * proportionally across every `solveDrawdown` call this function makes
   * for each of `targetNetAmount`'s own sub-amounts (`preferenceFor`
   * below) — deliberately *not* woven into the `"optimised"` strategy's
   * own who-draws-first tax-efficiency comparison, which stays exactly
   * as tax-driven as before; the preference only biases *how* whatever
   * each person ends up drawing is sourced, never *who* draws it.
   */
  taxablePreferenceAmount?: Pence,
): HouseholdDrawdownSolverResult<TId> {
  const [personA, personB] = people;
  if (!personA) {
    return { perPerson: [], totalNetAchieved: zeroPence(), totalTaxCost: zeroPence(), shortfall: targetNetAmount > 0 };
  }

  const preferenceFor = (amount: Pence): { taxablePreferenceAmount: Pence } | Record<string, never> => {
    if (taxablePreferenceAmount === undefined || targetNetAmount <= 0) return {};
    return { taxablePreferenceAmount: Math.round((taxablePreferenceAmount * amount) / targetNetAmount) as Pence };
  };

  if (!personB) {
    const result = solveDrawdown({ ...personA.state, targetNetAmount, capitalGainsRates, ...preferenceFor(targetNetAmount) });
    return combine([{ id: personA.id, result }]);
  }

  if (strategy.kind === "even") {
    return solveEvenOrCustom(targetNetAmount, [personA, personB], 0.5, capitalGainsRates, taxablePreferenceAmount);
  }
  if (strategy.kind === "custom") {
    return solveEvenOrCustom(targetNetAmount, [personA, personB], strategy.firstPersonShare, capitalGainsRates, taxablePreferenceAmount);
  }

  // "optimised": phase 1 — free tier for both. The probes stay
  // preference-aware too (rather than always tax-optimised) — if the
  // preference is biasing money away from the free tier (e.g. more
  // through pension than the 0%-cost PA band alone would use), the
  // free-capacity estimate should reflect that, not overstate it.
  const probeA = solveDrawdown({ ...personA.state, targetNetAmount, capitalGainsRates, ...preferenceFor(targetNetAmount) });
  const probeB = solveDrawdown({ ...personB.state, targetNetAmount, capitalGainsRates, ...preferenceFor(targetNetAmount) });
  const freeA = minPence(freeCapacityDrawn(probeA), targetNetAmount);
  let remaining = subtractPence(targetNetAmount, freeA);
  const freeB = minPence(freeCapacityDrawn(probeB), remaining);
  remaining = subtractPence(remaining, freeB);

  let resultA = freeA > 0 ? solveDrawdown({ ...personA.state, targetNetAmount: freeA, capitalGainsRates, ...preferenceFor(freeA) }) : EMPTY_RESULT;
  let resultB = freeB > 0 ? solveDrawdown({ ...personB.state, targetNetAmount: freeB, capitalGainsRates, ...preferenceFor(freeB) }) : EMPTY_RESULT;
  let stateA = applyResultToState(personA.state, resultA);
  let stateB = applyResultToState(personB.state, resultB);

  // Phase 2 — whichever person is cheaper for the remainder draws first.
  if (remaining > 0) {
    const soloA = solveDrawdown({ ...stateA, targetNetAmount: remaining, capitalGainsRates, ...preferenceFor(remaining) });
    const soloB = solveDrawdown({ ...stateB, targetNetAmount: remaining, capitalGainsRates, ...preferenceFor(remaining) });

    if (costPerNetPound(soloA) <= costPerNetPound(soloB)) {
      resultA = mergeDrawdownResults(resultA, soloA);
      stateA = applyResultToState(stateA, soloA);
      const stillNeeded = maxPence(subtractPence(remaining, soloA.netAchieved), zeroPence());
      if (stillNeeded > 0) {
        const soloB2 = solveDrawdown({ ...stateB, targetNetAmount: stillNeeded, capitalGainsRates, ...preferenceFor(stillNeeded) });
        resultB = mergeDrawdownResults(resultB, soloB2);
      }
    } else {
      resultB = mergeDrawdownResults(resultB, soloB);
      stateB = applyResultToState(stateB, soloB);
      const stillNeeded = maxPence(subtractPence(remaining, soloB.netAchieved), zeroPence());
      if (stillNeeded > 0) {
        const soloA2 = solveDrawdown({ ...stateA, targetNetAmount: stillNeeded, capitalGainsRates, ...preferenceFor(stillNeeded) });
        resultA = mergeDrawdownResults(resultA, soloA2);
      }
    }
  }

  return combine([
    { id: personA.id, result: resultA },
    { id: personB.id, result: resultB },
  ]);
}
