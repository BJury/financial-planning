import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export interface IsaContributionConfig {
  /** Which ISA `Account.id` this contribution funds. */
  readonly isaAccountId: string;
  readonly annualContribution: Pence;
}

const fields: readonly CatalogFieldSchema<IsaContributionConfig>[] = [
  { key: "isaAccountId", label: "ISA account", input: "select", required: true },
  { key: "annualContribution", label: "Annual contribution", input: "currency", required: true },
];

function validate(config: Readonly<IsaContributionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualContribution)) {
    issues.push({
      field: "annualContribution",
      tier: "hardBlock",
      message: "ISA contribution cannot be negative.",
    });
  }

  // Soft warning (exceeding the annual ISA subscription limit) is added
  // once this drain's calculateForYear has access to a TaxYearRuleSet's
  // isa.annualSubscriptionLimit (Phase 2, alongside the remaining ISA
  // types — Cash/Stocks & Shares/Lifetime — that all share this limit).

  return issues;
}

function isActive(): boolean {
  return true;
}

function calculateForYear(
  config: Readonly<IsaContributionConfig>,
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

export const isaContributionDefinition: IncomeDrainDefinition<IsaContributionConfig> = {
  type: "isaContribution",
  displayName: "ISA contribution",
  description: "A contribution into an ISA account",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(isaContributionDefinition);
