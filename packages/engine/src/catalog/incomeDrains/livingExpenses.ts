import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export interface LivingExpensesConfig {
  /** Already in today's terms (SPEC.md §5.8) — a flat real amount, not linked to any account. */
  readonly annualAmount: Pence;
}

const fields: readonly CatalogFieldSchema<LivingExpensesConfig>[] = [
  { key: "annualAmount", label: "Annual living expenses", input: "currency", required: true },
];

function validate(config: Readonly<LivingExpensesConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualAmount)) {
    issues.push({
      field: "annualAmount",
      tier: "hardBlock",
      message: "Annual living expenses cannot be negative.",
    });
  }

  return issues;
}

function isActive(): boolean {
  // Recurring for every simulated year it's configured for, unless
  // bounded by the generic start/end date scheduling every instance
  // carries (SPEC.md §3.11) — e.g. a sabbatical modelled as a second,
  // higher LivingExpenses instance active only for those years.
  return true;
}

function calculateForYear(
  config: Readonly<LivingExpensesConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.annualAmount,
    // Ordinary spending is not deductible (SPEC.md §3.9) — this reduces
    // spendable cash (`netIncome`), not taxable income.
    taxTreatment: "none" as const,
  };
}

export const livingExpensesDefinition: IncomeDrainDefinition<LivingExpensesConfig> = {
  type: "livingExpenses",
  displayName: "Living expenses",
  description:
    "Optional — a Retirement income target already counts as spent once achieved, so this isn't needed for the usual case. Use it only to track spending that genuinely differs from the target, e.g. a known one-off higher- or lower-spending period",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(livingExpensesDefinition);
