import {
  addPence,
  convertNominalToReal,
  minPence,
  multiplyPenceByRate,
  pence,
  poundsToPence,
  subtractPence,
  zeroPence,
  type Account,
  type Pence,
  type PersonId,
  type Scenario,
} from "@fp/engine";
import { isoDateFromAge } from "./components/AgeOrDateInput.js";
import { computeProjection } from "./projection.js";

export type GapAccountKind = "cash" | "isa" | "pension" | "gia";

export const GAP_ACCOUNT_KIND_LABELS: Record<GapAccountKind, string> = {
  cash: "Cash",
  isa: "ISA",
  pension: "Pension",
  gia: "GIA",
};

export interface ShortfallGap {
  readonly kind: GapAccountKind;
  /**
   * The minimum extra amount, added once (today, at the start of the
   * plan) to this person's own existing account of this kind — or a new
   * one with this app's usual default assumptions, if they don't have
   * one — that would have avoided every shortfall in this plan.
   * `undefined` if no finite amount does; see `unfixableReason`.
   */
  readonly extraNeeded: Pence | undefined;
  readonly unfixableReason?: string;
}

// Beyond this, treated as "not fixable by this account kind alone" —
// comfortably past any real shortfall this app would ever compute.
const SEARCH_CAP = poundsToPence(10_000_000);
const SEARCH_PRECISION = poundsToPence(50);

function anyShortfall(scenario: Scenario): boolean {
  const result = computeProjection(scenario);
  return result.rows.some((row) => row.perPerson.some((p) => p.drawdownShortfall || p.livingExpensesShortfall));
}

/**
 * The first person (household order, then row/year order) with any
 * shortfall — the one this whole feature is about. A top-up only
 * actually reaches whichever person's own (or joint) account it's added
 * to, so a two-person household's gap is scoped to whoever's actually
 * short, not split or guessed at.
 */
function findShortfallOwner(scenario: Scenario): PersonId | undefined {
  const result = computeProjection(scenario);
  for (const row of result.rows) {
    const hit = row.perPerson.find((p) => p.drawdownShortfall || p.livingExpensesShortfall);
    if (hit) return hit.personId;
  }
  return undefined;
}

/** Mirrors the real ownership-eligibility rule each account kind already uses elsewhere in this engine (SPEC.md §3.4–§3.7): ISA/pension never joint, cash/GIA can be. */
function findExistingAccountIndex(scenario: Scenario, kind: GapAccountKind, owner: PersonId): number {
  return scenario.accounts.findIndex(
    (a) => a.kind === kind && (a.owner === owner || ((kind === "cash" || kind === "gia") && a.owner === "joint")),
  );
}

/** Same default assumptions as the "+ Add pension/ISA/GIA/cash" buttons (Onboarding.tsx) — a hypothetical new account here should look exactly like one a user would actually add. */
function synthesizeAccount(kind: GapAccountKind, owner: PersonId, balance: Pence, scenario: Scenario): Account {
  const equityGrowth = convertNominalToReal(0.085, scenario.inflationRate);
  switch (kind) {
    case "pension": {
      const person = scenario.household.people.find((p) => p.id === owner);
      return {
        kind: "pension",
        id: "shortfall-gap:pension",
        owner,
        pensionType: "sipp",
        currentBalance: balance,
        annualGrowthRate: equityGrowth,
        annualChargeRate: 0.0005,
        employerAnnualContribution: zeroPence(),
        ...(person ? { accessDate: isoDateFromAge(person.dateOfBirth, 57) } : {}),
      };
    }
    case "isa":
      return { kind: "isa", id: "shortfall-gap:isa", owner, isaType: "stocksAndShares", currentBalance: balance, annualGrowthRate: 0 };
    case "gia":
      return {
        kind: "gia",
        id: "shortfall-gap:gia",
        owner,
        currentBalance: balance,
        costBasis: balance,
        annualGrowthRate: equityGrowth,
        annualDividendYield: 0,
      };
    case "cash":
      return { kind: "cash", id: "shortfall-gap:cash", owner, currentBalance: balance, annualGrowthRate: 0 };
  }
}

function withExtraBalance(scenario: Scenario, kind: GapAccountKind, owner: PersonId, extra: Pence): Scenario {
  const index = findExistingAccountIndex(scenario, kind, owner);
  if (index !== -1) {
    const accounts = scenario.accounts.map((a, i) => (i === index ? { ...a, currentBalance: addPence(a.currentBalance, extra) } : a));
    return { ...scenario, accounts };
  }
  return { ...scenario, accounts: [...scenario.accounts, synthesizeAccount(kind, owner, extra, scenario)] };
}

/**
 * A pure black-box search over the real engine (bump the balance,
 * re-run the whole projection, check whether any shortfall remains)
 * rather than a formula derived by hand — the actual rules governing
 * which account a shortfall can draw from (SPEC.md §5.1 step 7's cash→
 * ISA→GIA order, never a pension for a Living Expenses shortfall; a
 * Retirement income target drawing from all four pooled) already live
 * correctly in `runProjection`, and re-deriving them here risks drifting
 * out of sync with the real thing. This is also *why* the result can
 * legitimately come back `undefined`: no amount of extra pension alone
 * can fix a shortfall the engine would never draw a pension for in the
 * first place.
 */
function findMinimumExtra(scenario: Scenario, kind: GapAccountKind, owner: PersonId): Pence | undefined {
  let high = poundsToPence(1000);
  while (anyShortfall(withExtraBalance(scenario, kind, owner, high))) {
    if (high >= SEARCH_CAP) return undefined;
    high = minPence(multiplyPenceByRate(high, 2), SEARCH_CAP);
  }
  let low = zeroPence();
  while (subtractPence(high, low) > SEARCH_PRECISION) {
    const mid = pence(Math.floor((low + high) / 2));
    if (anyShortfall(withExtraBalance(scenario, kind, owner, mid))) {
      low = mid;
    } else {
      high = mid;
    }
  }
  return high;
}

/**
 * One line per account kind (SPEC.md §7-adjacent "what would it take"
 * ask): how much more, in that kind alone, would have avoided every
 * shortfall in this plan. Returns `[]` when there's no shortfall to
 * begin with — callers should gate rendering on that, not call this
 * unconditionally, since each kind runs its own multi-iteration search
 * (four black-box searches, each many `runProjection` calls).
 */
export function computeShortfallGaps(scenario: Scenario): readonly ShortfallGap[] {
  const owner = findShortfallOwner(scenario);
  if (!owner) return [];

  const baseline = computeProjection(scenario);
  const onlyLivingExpensesShortfall = !baseline.rows.some((row) => row.perPerson.some((p) => p.drawdownShortfall));

  const kinds: readonly GapAccountKind[] = ["cash", "isa", "pension", "gia"];
  return kinds.map((kind) => {
    const extraNeeded = findMinimumExtra(scenario, kind, owner);
    if (extraNeeded !== undefined) return { kind, extraNeeded };
    return {
      kind,
      extraNeeded: undefined,
      unfixableReason:
        kind === "pension" && onlyLivingExpensesShortfall
          ? "a pension is never drawn from to cover Living Expenses — only a Retirement income target does that"
          : "no realistic amount in this account alone resolves it",
    };
  });
}
