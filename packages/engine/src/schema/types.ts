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
// Phase 1 ships PensionAccount and ISAAccount only; GIAAccount,
// CashAccount, and Property are added in Phase 2/3 as siblings of this
// same discriminated union, per SPEC.md §8's `Account` polymorphic type.

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
}

export interface IsaAccount extends AccountBase {
  readonly kind: "isa";
  /** ISAs can never be jointly held (SPEC.md §3.5) — owner is always a specific Person. */
  readonly owner: PersonId;
  readonly isaType: "cash" | "stocksAndShares" | "lifetime";
  readonly currentBalance: Pence;
}

export type Account = PensionAccount | IsaAccount;

// --- Income Sources / Drains ---------------------------------------------

/** One instance of a catalog type (SPEC.md §3.11, §8) — `config` is that type's own shape. */
export interface IncomeSourceInstance<TConfig = unknown> {
  readonly id: string;
  /** Registry key, e.g. `"salary"` — see catalog/registry.ts. */
  readonly type: string;
  readonly owner: Owner;
  readonly config: TConfig;
}

export interface IncomeDrainInstance<TConfig = unknown> {
  readonly id: string;
  readonly type: string;
  readonly owner: Owner;
  readonly config: TConfig;
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
