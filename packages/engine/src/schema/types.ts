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
  /**
   * The id of the person electing to transfer 10% of their Personal
   * Allowance to their spouse/civil partner (SPEC.md §5.2) — only
   * meaningful when `relationshipStatus` is `"marriedOrCivilPartnership"`
   * and the household has two people. A single scenario-level election
   * (not a separate per-year toggle) that the engine checks for
   * eligibility fresh each year — SPEC.md's "not always optimal to
   * claim" concern is about the user's *intent* to elect, not about the
   * engine silently deciding when to apply it; the engine still refuses
   * to apply it in a year either person is ineligible.
   */
  readonly marriageAllowanceElection?: PersonId;
}

// --- Accounts -----------------------------------------------------------

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

/**
 * A mortgage is always secured against exactly one property, so it's not
 * a standalone Account type — embedded directly in `Property` (SPEC.md
 * §3.8, §8). Interest/capital are tracked separately (via
 * `mortgage/amortizeMortgageYear.ts`) since a rental property's Income
 * Tax calculation needs the interest portion specifically (§5.6).
 *
 * Tracked internally in **nominal** pounds throughout the simulation
 * (`simulation/runProjection.ts`), unlike every other balance in this
 * engine — a mortgage is a genuinely nominal, fixed-in-cash-terms
 * contract (SPEC.md §5.8's fixed-rate-mortgage example), not a value the
 * user thinks of in today's money the way an investment balance is. Both
 * `initialBalance` and `annualPayment` are still entered/displayed in
 * today's money like everything else, since at the scenario's start year
 * nominal and real are numerically identical (no inflation has yet
 * elapsed) — the distinction only matters once the simulation starts
 * stepping forward, which `deflateNominalAmount` handles.
 */
export interface Mortgage {
  readonly initialBalance: Pence;
  /** Entered as a genuine nominal contract rate — never Fisher-converted (unlike every other growth rate in this engine, SPEC.md §3.10). */
  readonly nominalInterestRate: number;
  readonly repaymentType: "repayment" | "interestOnly";
  /**
   * Remaining term in whole years from the scenario's start (SPEC.md §3.8
   * asks for months; simplified to whole years, matching this engine's
   * whole-tax-year granularity everywhere else, e.g. `activeDateRange.ts`).
   */
  readonly termYears: number;
  /**
   * Fixed for the whole term (a real fixed-rate mortgage's actual monthly
   * payment doesn't change), in nominal pounds at the scenario's start —
   * derived from balance/rate/term via the standard amortisation formula
   * in the UI, or entered directly. Simplification: no fixed-period-then-
   * reversion-rate modelling, and no planned overpayments (SPEC.md §3.8
   * lists both as optional refinements) — v1 models one flat rate for the
   * whole term.
   */
  readonly annualPayment: Pence;
}

export interface RentalDetails {
  /** Today's money at the scenario's start; compounds by `annualGrowthRate` (SPEC.md §5.8's "rental growth", distinct from the property's own house-price growth). */
  readonly grossAnnualRentalIncome: Pence;
  readonly lettingCosts: Pence;
  readonly annualGrowthRate: number;
}

export interface PlannedSale {
  /** ISO date — the tax year containing this date is when the sale is modelled (SPEC.md §3.8). */
  readonly saleDate: string;
  /** If omitted, the engine grows the property's current value to the sale date at its own house-price growth rate instead (SPEC.md §3.8). */
  readonly expectedSalePrice?: Pence;
  readonly sellingCosts: Pence;
}

export interface Property extends AccountBase {
  readonly kind: "property";
  /** A property can be jointly held (SPEC.md §3.8), unlike a pension or ISA. */
  readonly owner: Owner;
  readonly propertyType: "mainResidence" | "rental";
  /**
   * Current market value — named `currentBalance` (not `currentValue`)
   * for consistency with every other `Account`'s field name, so
   * `runProjection`'s generic balance-seeding/growth loop needs no
   * Property-specific branch even though this is semantically a value,
   * not a cash balance.
   */
  readonly currentBalance: Pence;
  readonly purchasePrice: Pence;
  /** ISO date — the CGT cost basis's acquisition date (SPEC.md §3.8). */
  readonly purchaseDate: string;
  /** Present only when `propertyType === "rental"` (SPEC.md §3.8). */
  readonly rentalDetails?: RentalDetails;
  readonly plannedSale?: PlannedSale;
  readonly mortgage?: Mortgage;
}

export type Account = PensionAccount | IsaAccount | GiaAccount | CashAccount | Property;

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
