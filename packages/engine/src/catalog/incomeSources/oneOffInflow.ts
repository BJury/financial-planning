import { isNegative, type Pence } from "../../money/pence.js";
import { isWithinActiveDateRange } from "../../schema/activeDateRange.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeSourceDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export type OneOffInflowCategory = "inheritance" | "giftReceived" | "other";

export interface OneOffInflowConfig {
  readonly amount: Pence;
  readonly date: string; // ISO date — the specific tax year it lands in is what's actually checked
  readonly category: OneOffInflowCategory;
  /**
   * An ISA, GIA, or cash `Account.id` to invest/deposit this inflow into
   * directly, if any — resolved and credited in
   * `simulation/runProjection.ts` (a catalog type's own
   * `calculateForYear` never sees account balances, SPEC.md §9.1/§9.4,
   * the same reason `targetDrawdownIncome` is special-cased there too).
   * Left unset, the amount just becomes ordinary spendable tax-free
   * income, exactly as before this field existed — picked up by the
   * automatic surplus sweep only if nothing else consumes it that year.
   * An ISA destination is capped at the person's remaining annual
   * subscription limit (shared with any manual ISA contribution drain
   * and the surplus sweep, all three drawing on the same pool); GIA and
   * cash destinations have no cap.
   */
  readonly destinationAccountId?: string;
}

const fields: readonly CatalogFieldSchema<OneOffInflowConfig>[] = [
  { key: "amount", label: "Amount", input: "currency", required: true },
  { key: "date", label: "Date", input: "date", required: true },
  {
    key: "category",
    label: "Category",
    input: "select",
    required: true,
    options: [
      { value: "inheritance", label: "Inheritance" },
      { value: "giftReceived", label: "Gift received" },
      { value: "other", label: "Other" },
    ],
  },
  { key: "destinationAccountId", label: "Invest into (optional)", input: "select", required: false },
];

function validate(config: Readonly<OneOffInflowConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.amount)) {
    issues.push({ field: "amount", tier: "hardBlock", message: "Amount cannot be negative." });
  }
  if (!config.date) {
    issues.push({ field: "date", tier: "hardBlock", message: "A date is required." });
  }

  return issues;
}

function isActive(config: Readonly<OneOffInflowConfig>, _state: ScenarioState, yearContext: YearContext, _owner: Owner): boolean {
  // Active for exactly the one tax year the date falls in — reuses the
  // same year-granularity date-range check every instance's generic
  // scheduling uses (schema/activeDateRange.ts), applied here to a
  // single point in time rather than a range.
  return isWithinActiveDateRange(config.date, config.date, yearContext.calendarYear);
}

/**
 * Every category here is treated as tax-free (SPEC.md §3.9's inheritance
 * example) — a category that would actually generate taxable income
 * (e.g. a redundancy payment's excess over the £30,000 exemption) isn't
 * offered yet, since it needs its own split-amount tax treatment rather
 * than this type's single flat category; getting that wrong (taxing
 * something that shouldn't be taxed, or the reverse) is worse than not
 * offering it, so it's deferred rather than approximated.
 */
function calculateForYear(
  config: Readonly<OneOffInflowConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    kind: "simple" as const,
    amount: config.amount,
    taxCategory: "taxFree" as const,
  };
}

export const oneOffInflowDefinition: IncomeSourceDefinition<OneOffInflowConfig> = {
  type: "oneOffInflow",
  displayName: "One-off inflow",
  description: "A single dated cash inflow — an inheritance, a gift received, and so on",
  taxCategory: "taxFree",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(oneOffInflowDefinition);
