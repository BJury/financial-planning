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
