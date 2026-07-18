import { isNegative, type Pence } from "../../money/pence.js";
import { isWithinActiveDateRange } from "../../schema/activeDateRange.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export type OneOffOutflowCategory = "housingDeposit" | "giftGiven" | "weddingCost" | "other";

export interface OneOffOutflowConfig {
  readonly amount: Pence;
  readonly date: string; // ISO date — the specific tax year it lands in is what's actually checked
  /** Informational only — every category has the same (no) tax effect (SPEC.md §3.9: not deductible). */
  readonly category: OneOffOutflowCategory;
}

const fields: readonly CatalogFieldSchema<OneOffOutflowConfig>[] = [
  { key: "amount", label: "Amount", input: "currency", required: true },
  { key: "date", label: "Date", input: "date", required: true },
  {
    key: "category",
    label: "Category",
    input: "select",
    required: true,
    options: [
      { value: "housingDeposit", label: "House deposit" },
      { value: "giftGiven", label: "Gift given" },
      { value: "weddingCost", label: "Wedding cost" },
      { value: "other", label: "Other" },
    ],
  },
];

function validate(config: Readonly<OneOffOutflowConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.amount)) {
    issues.push({ field: "amount", tier: "hardBlock", message: "Amount cannot be negative." });
  }
  if (!config.date) {
    issues.push({ field: "date", tier: "hardBlock", message: "A date is required." });
  }

  return issues;
}

function isActive(config: Readonly<OneOffOutflowConfig>, _state: ScenarioState, yearContext: YearContext, _owner: Owner): boolean {
  return isWithinActiveDateRange(config.date, config.date, yearContext.calendarYear);
}

function calculateForYear(
  config: Readonly<OneOffOutflowConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.amount,
    // Not deductible (SPEC.md §3.9) — reduces spendable cash, not taxable income.
    taxTreatment: "none" as const,
  };
}

export const oneOffOutflowDefinition: IncomeDrainDefinition<OneOffOutflowConfig> = {
  type: "oneOffOutflow",
  displayName: "One-off outflow",
  description: "A single dated cash outflow — a house deposit, a gift given, and so on",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(oneOffOutflowDefinition);
