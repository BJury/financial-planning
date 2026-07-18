import type { Pence } from "../money/pence.js";
import type { UpratingPolicy } from "../realTerms/uprateThreshold.js";

/**
 * Branded (not a bare `string`) so it doesn't structurally swallow the
 * `"joint"` literal in `Owner` below — a plain `string | "joint"` union
 * collapses to just `string` from the type checker's point of view,
 * which defeats the purpose of the union entirely.
 */
export type PersonId = string & { readonly __brand: "PersonId" };

export function personId(value: string): PersonId {
  return value as PersonId;
}

/**
 * Every jointly-ownable Account/IncomeSource/IncomeDrain uses this union
 * (SPEC.md §3.1, §8) — `'joint'` is unused until Phase 5, but the type is
 * shaped this way from Phase 1 so nothing built before Phase 5 has to be
 * touched when the second Person is introduced (implementation plan risk #2).
 */
export type Owner = PersonId | "joint";

export interface Person {
  readonly id: PersonId;
  readonly dateOfBirth: string; // ISO date, e.g. "1980-06-15"
  /**
   * A UI default only — pre-fills a TargetDrawdownIncome's start age and
   * a Salary's end age when first added. Never read by the simulation
   * loop itself (SPEC.md §3.2, §8).
   */
  readonly targetRetirementAge: number;
  readonly projectionEndAge: number;
}

/**
 * Deliberately `people: readonly Person[]`, never a singular `person`
 * field — even though Phase 1 only ever populates one entry. Getting
 * this wrong makes Phase 5 (the second Person) a schema migration and a
 * persistence-format break instead of "add an array entry"
 * (implementation plan risk #2).
 */
export interface Household {
  readonly people: readonly Person[];
  /** `null` for a single-person household — there is no relationship to state. */
  readonly relationshipStatus: "marriedOrCivilPartnership" | "unmarried" | null;
  /** SPEC.md §3.1 — irrelevant for a single-person household. */
  readonly targetIncomeMode: "combined" | "perPerson";
}

// --- Accounts -----------------------------------------------------------
// Property is added in Phase 3 as a further sibling of this same
// discriminated union, per SPEC.md §8's `Account` polymorphic type.

interface AccountBase {
  readonly id: string;
  /** Already a *real* rate, same convention as SalaryConfig.annualGrowthRate (SPEC.md §3.10, §5.8). */
  readonly annualGrowthRate: number;
}

export interface PensionAccount extends AccountBase {
  readonly kind: "pension";
  /** Pensions can never be jointly held (SPEC.md §3.4) — owner is always a specific Person. */
  readonly owner: PersonId;
  readonly pensionType: "workplaceDC" | "sipp";
  readonly currentBalance: Pence;
  readonly annualChargeRate: number;
  /**
   * A flat annual amount, not an IncomeDrain — employer contributions
   * aren't a cash outflow from the person's own income at all, just
   * money the employer adds directly (SPEC.md §3.4). They count toward
   * the Annual Allowance and are never taxed as the employee's income
   * (SPEC.md §5.4).
   */
  readonly employerAnnualContribution: Pence;
}

export interface IsaAccount extends AccountBase {
  readonly kind: "isa";
  /** ISAs can never be jointly held (SPEC.md §3.5) — owner is always a specific Person. */
  readonly owner: PersonId;
  readonly isaType: "cash" | "stocksAndShares" | "lifetime";
  readonly currentBalance: Pence;
}

export interface GiaAccount extends AccountBase {
  readonly kind: "gia";
  /**
   * A GIA can be jointly held (SPEC.md §3.6), unlike a pension or ISA —
   * typed as `Owner` now even though the current single-person UI never
   * sets `"joint"`, so this doesn't need reshaping when Phase 5's 50/50
   * income-splitting for joint accounts is built.
   */
  readonly owner: Owner;
  readonly currentBalance: Pence;
  /**
   * The total amount originally invested, tracked separately from
   * `currentBalance` from day one (SPEC.md §3.6) — needed for a future
   * capital-gain-on-withdrawal calculation (SPEC.md §5.5, §5.7.2); if
   * this weren't split out now, reconstructing historical cost basis
   * later wouldn't be possible.
   */
  readonly costBasis: Pence;
  /**
   * `annualGrowthRate` (from AccountBase) is capital appreciation only —
   * unrealised and untaxed until a future withdrawal, per SPEC.md §5.5's
   * "buy-and-hold" default (capital gains aren't modelled as realised
   * during accumulation; that's a Phase 4 drawdown-time calculation, not
   * built yet). This is the separate income portion (dividends), taxed
   * annually via the Dividend Allowance and reinvested — an
   * interest-bearing GIA holding isn't modelled separately in v1; use a
   * `CashAccount` for that instead (SPEC.md §3.6's "split between income
   * and capital growth").
   */
  readonly annualDividendYield: number;
}

export interface CashAccount extends AccountBase {
  readonly kind: "cash";
  /** Can be jointly held (SPEC.md §3.7) — see the note on GiaAccount.owner above. */
  readonly owner: Owner;
  readonly currentBalance: Pence;
  // `annualGrowthRate` (from AccountBase) *is* the interest rate here —
  // unlike every other account type, cash has no separate untaxed growth
  // component: all of it is taxable interest income each year (SPEC.md §3.7, §5.5).
}

export type Account = PensionAccount | IsaAccount | GiaAccount | CashAccount;

// --- Income Sources / Drains ---------------------------------------------

/** One instance of a catalog type (SPEC.md §3.11, §8) — `config` is that type's own shape. */
export interface IncomeSourceInstance<TConfig = unknown> {
  readonly id: string;
  /** Registry key, e.g. `"salary"` — see catalog/registry.ts. */
  readonly type: string;
  readonly owner: Owner;
  readonly config: TConfig;
  /**
   * Optional generic scheduling (ISO dates), independent of any
   * type-specific `isActive` check (e.g. Salary's age-based `endAge`) —
   * lets a rental starting in 5 years and running for 10 be expressed
   * without every catalog type implementing its own start/end handling
   * (see schema/activeDateRange.ts).
   */
  readonly startDate?: string;
  readonly endDate?: string;
}

export interface IncomeDrainInstance<TConfig = unknown> {
  readonly id: string;
  readonly type: string;
  readonly owner: Owner;
  readonly config: TConfig;
  readonly startDate?: string;
  readonly endDate?: string;
}

// --- Scenario --------------------------------------------------------------

export interface Scenario {
  readonly schemaVersion: number;
  readonly household: Household;
  readonly accounts: readonly Account[];
  readonly incomeSources: readonly IncomeSourceInstance[];
  readonly incomeDrains: readonly IncomeDrainInstance[];
  /** A single flat CPI assumption for the whole plan (SPEC.md §3.10). */
  readonly inflationRate: number;
  readonly upratingPolicy: UpratingPolicy;
}
