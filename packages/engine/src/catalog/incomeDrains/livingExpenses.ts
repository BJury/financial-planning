import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

/** Informational only — every category has the same (no) tax effect (SPEC.md §3.9: not deductible), mirroring `OneOffOutflowCategory`. */
export type ContinuousOutflowCategory = "livingCosts" | "educationFees" | "careCosts" | "debtRepayment" | "other";

export interface LivingExpensesConfig {
  /** Already in today's terms (SPEC.md §5.8) — a flat real amount, not linked to any account. */
  readonly annualAmount: Pence;
  readonly category: ContinuousOutflowCategory;
}

const fields: readonly CatalogFieldSchema<LivingExpensesConfig>[] = [
  { key: "annualAmount", label: "Amount per year", input: "currency", required: true },
  {
    key: "category",
    label: "Category",
    input: "select",
    required: true,
    options: [
      { value: "livingCosts", label: "General living costs" },
      { value: "educationFees", label: "School/university fees" },
      { value: "careCosts", label: "Care costs" },
      { value: "debtRepayment", label: "Loan/debt repayment" },
      { value: "other", label: "Other" },
    ],
  },
];

function validate(config: Readonly<LivingExpensesConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualAmount)) {
    issues.push({
      field: "annualAmount",
      tier: "hardBlock",
      message: "Amount cannot be negative.",
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
  // Kept as "livingExpenses" (not renamed to e.g. "continuousOutflow")
  // so existing persisted scenarios (IndexedDB autosave, exported plan
  // files) still resolve against the registry — this is a display-name
  // and framing change only, matching how "Contributions" was already
  // split out as a UI-layer grouping without an engine type rename.
  type: "livingExpenses",
  displayName: "Continuous outflow",
  description:
    "A known recurring cost over a period — school fees, care costs, a loan repayment, or general living costs — so it's accounted for in your net income",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(livingExpensesDefinition);
