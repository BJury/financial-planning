import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export interface CashContributionConfig {
  /** Which cash `Account.id` this contribution funds. */
  readonly cashAccountId: string;
  readonly annualContribution: Pence;
}

const fields: readonly CatalogFieldSchema<CashContributionConfig>[] = [
  { key: "cashAccountId", label: "Cash account", input: "select", required: true },
  { key: "annualContribution", label: "Annual contribution", input: "currency", required: true },
];

function validate(config: Readonly<CashContributionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualContribution)) {
    issues.push({
      field: "annualContribution",
      tier: "hardBlock",
      message: "Cash contribution cannot be negative.",
    });
  }

  return issues;
}

function isActive(): boolean {
  return true;
}

function calculateForYear(
  config: Readonly<CashContributionConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.annualContribution,
    // Funded from already-taxed income — not itself deductible (SPEC.md §3.11).
    taxTreatment: "none" as const,
  };
}

export const cashContributionDefinition: IncomeDrainDefinition<CashContributionConfig> = {
  type: "cashContribution",
  displayName: "Cash savings contribution",
  description: "A contribution into a cash savings account",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(cashContributionDefinition);
