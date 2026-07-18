import type { Pence } from "../money/pence.js";
import type { Owner, Scenario } from "../schema/types.js";

/**
 * How an Income Source is taxed — required on every catalog type, never
 * a bare "is this taxable" boolean (SPEC.md §3.11): in UK tax law *how*
 * something is taxed matters as much as *whether* it is.
 */
export type TaxCategory =
  | "taxFree"
  | "earnedIncome"
  | "pensionIncome"
  | "statePensionIncome"
  | "rentalProfit"
  | "savingsInterest"
  | "dividendIncome"
  | "capitalGain";

/** How an Income Drain interacts with tax/NI (SPEC.md §3.11, §5.4). */
export type TaxTreatment =
  | "none"
  | "reducesTaxableIncomeNetPay"
  | "reducesTaxableIncomeAndNISalarySacrifice"
  | "reliefAtSourceBasicRateTopUp";

/**
 * `"growthRate"` is deliberately distinct from the generic `"percentage"`
 * kind: a growth/return rate is entered by the user as a *nominal*
 * figure and needs converting to real via the Scenario's inflation
 * assumption before it's stored (SPEC.md §3.10, §5.8) — an ordinary
 * percentage field (should one exist later) has no such conversion and
 * must not be swept into the same UI treatment by accident.
 */
export type CatalogInputKind = "currency" | "percentage" | "growthRate" | "date" | "age" | "select" | "text" | "boolean";

export interface CatalogFieldSchema<TConfig> {
  readonly key: keyof TConfig & string;
  readonly label: string;
  readonly input: CatalogInputKind;
  readonly required: boolean;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
}

/** SPEC.md §3.12 — every field's validation problem is tagged with exactly one tier. */
export interface ValidationIssue {
  readonly field: string;
  readonly tier: "hardBlock" | "softWarning";
  readonly message: string;
}

/** What every catalog type returns in Phase 1 — a single amount and its tax category. */
export interface SimpleResult {
  readonly kind: "simple";
  readonly amount: Pence;
  readonly taxCategory: TaxCategory;
}

/**
 * The composite return shape `TargetDrawdownIncome` (Phase 4) uses
 * instead of `SimpleResult` — decided now, in Phase 1, even though
 * nothing produces it yet, because retrofitting this union after several
 * catalog types already assume a bare `{amount, taxCategory}` shape
 * would mean reshaping every one of them plus every call site in the
 * simulation loop (implementation plan risk #1).
 */
export type DrawdownBucket =
  | "taxFreeISA"
  | "taxFreePensionLumpSum"
  | "taxFreeCashPrincipal"
  | "taxFreeGIAReturnOfCapital"
  | "taxablePersonalAllowance"
  | "taxableBasicRate"
  | "taxableHigherRate"
  | "taxableAdditionalRate"
  | "capitalGainWithinAllowance"
  | "capitalGainTaxable";

export interface BucketedResult {
  readonly kind: "bucketed";
  readonly totalAmount: Pence;
  readonly buckets: readonly {
    readonly bucket: DrawdownBucket;
    readonly amount: Pence;
    readonly taxCategory: TaxCategory;
    readonly taxCost: Pence;
  }[];
}

export type CalculationResult = SimpleResult | BucketedResult;

export interface DrainResult {
  readonly amount: Pence;
  readonly taxTreatment: TaxTreatment;
}

/**
 * Everything a catalog type's `calculateForYear`/`isActive` needs to see.
 * Exposes the *whole* Scenario (and therefore `scenario.household.people`
 * — every person, not just the item's own owner) from Phase 1, even
 * though Phase 1's own types (Salary, PensionContribution, ISA
 * contribution) never look past their own owner — a combined-household
 * TargetDrawdownIncome (Phase 4/5) needs to see both people's tax
 * positions from a single catalog item's calculation (implementation
 * plan risk #3).
 */
export interface ScenarioState {
  readonly scenario: Scenario;
  readonly accountBalances: ReadonlyMap<string, Pence>;
}

export interface YearContext {
  /** e.g. "2026-27" */
  readonly taxYear: string;
  /** The calendar year in which this tax year starts, e.g. 2026 for "2026-27". */
  readonly calendarYear: number;
  /**
   * 0-based count of years since the Scenario's start year — the input a
   * catalog type uses to compound its own base amount by its own
   * already-real growth rate directly (via `compoundPenceByRate`),
   * rather than the simulation loop threading a running "current amount"
   * for every instance year over year.
   */
  readonly yearIndex: number;
}

export interface IncomeSourceDefinition<TConfig> {
  /** Unique registry key, e.g. `"salary"`. */
  readonly type: string;
  readonly displayName: string;
  readonly description: string;
  readonly taxCategory: TaxCategory;
  readonly fields: readonly CatalogFieldSchema<TConfig>[];
  validate(config: Readonly<TConfig>): readonly ValidationIssue[];
  isActive(config: Readonly<TConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): boolean;
  calculateForYear(config: Readonly<TConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): CalculationResult;
}

export interface IncomeDrainDefinition<TConfig> {
  readonly type: string;
  readonly displayName: string;
  readonly description: string;
  readonly taxTreatment: TaxTreatment;
  readonly fields: readonly CatalogFieldSchema<TConfig>[];
  validate(config: Readonly<TConfig>): readonly ValidationIssue[];
  isActive(config: Readonly<TConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): boolean;
  calculateForYear(config: Readonly<TConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): DrainResult;
}
