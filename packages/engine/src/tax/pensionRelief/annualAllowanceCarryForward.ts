import { minPence, subtractPence, type Pence } from "../../money/pence.js";

export interface AnnualAllowanceCarryForwardInput {
  /** This year's total gross pension contributions, across every account and relief method. */
  readonly totalContribution: Pence;
  /** This year's own (possibly tapered) Annual Allowance. */
  readonly currentYearAllowance: Pence;
  /**
   * Unused allowance from each of the previous up-to-3 tax years,
   * **oldest first** — index 0 is 3 years ago, expiring at the end of
   * this calculation; the newest entry is last year's. A person with no
   * simulated history yet (the first year of a plan) starts with an
   * empty array — a stated simplification (SPEC.md §11-style: this
   * engine doesn't know a person's real pre-simulation contribution
   * history) rather than assuming unused allowance that may not exist.
   */
  readonly unusedAllowanceByPreviousThreeYears: readonly Pence[];
}

export interface AnnualAllowanceCarryForwardResult {
  /** The amount of this year's contribution that exceeded every available allowance (current year + carry-forward) — chargeable (SPEC.md §5.4). */
  readonly excessContribution: Pence;
  /** The rolling window to use as `unusedAllowanceByPreviousThreeYears` for *next* year's calculation — always at most 3 entries. */
  readonly nextUnusedAllowanceByPreviousThreeYears: readonly Pence[];
}

/**
 * Applies a year's pension contributions against the Annual Allowance
 * cumulative, cross-year running total (SPEC.md §5.4, implementation
 * plan risk on AA carry-forward): consumes this year's own allowance
 * first, then carried-forward allowance oldest-first (since the oldest
 * carry-forward is the next to expire), and returns both the chargeable
 * excess and the updated 3-year window for the caller to thread into
 * next year's call. A pure function — the running total is an explicit
 * input and output, never hidden state (SPEC.md §9.3).
 */
export function applyAnnualAllowanceCarryForward(
  input: AnnualAllowanceCarryForwardInput,
): AnnualAllowanceCarryForwardResult {
  const { totalContribution, currentYearAllowance, unusedAllowanceByPreviousThreeYears } = input;

  let remaining = totalContribution;

  const usedFromCurrentYear = minPence(remaining, currentYearAllowance);
  remaining = subtractPence(remaining, usedFromCurrentYear);

  const carryForwardAfterUse = unusedAllowanceByPreviousThreeYears.map((available) => {
    if (remaining <= 0) {
      return available;
    }
    const used = minPence(remaining, available);
    remaining = subtractPence(remaining, used);
    return subtractPence(available, used);
  });

  const excessContribution = remaining;
  const thisYearUnused = subtractPence(currentYearAllowance, usedFromCurrentYear);
  const nextUnusedAllowanceByPreviousThreeYears = [...carryForwardAfterUse.slice(1), thisYearUnused].slice(-3);

  return { excessContribution, nextUnusedAllowanceByPreviousThreeYears };
}

/** The starting window for a person with no prior simulated history. */
export function emptyCarryForwardWindow(): readonly Pence[] {
  return [];
}
