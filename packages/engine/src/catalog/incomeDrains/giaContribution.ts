import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export interface GiaContributionConfig {
  /** Which GIA `Account.id` this contribution funds. */
  readonly giaAccountId: string;
  readonly annualContribution: Pence;
}

const fields: readonly CatalogFieldSchema<GiaContributionConfig>[] = [
  { key: "giaAccountId", label: "GIA account", input: "select", required: true },
  { key: "annualContribution", label: "Annual contribution", input: "currency", required: true },
];

function validate(config: Readonly<GiaContributionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualContribution)) {
    issues.push({
      field: "annualContribution",
      tier: "hardBlock",
      message: "GIA contribution cannot be negative.",
    });
  }

  return issues;
}

function isActive(): boolean {
  return true;
}

function calculateForYear(
  config: Readonly<GiaContributionConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.annualContribution,
    // Funded from already-taxed income — not itself deductible (SPEC.md §3.11).
    // The simulation loop credits this to both the account's balance and
    // its cost basis (SPEC.md §3.6) — new money invested, not a gain.
    taxTreatment: "none" as const,
  };
}

export const giaContributionDefinition: IncomeDrainDefinition<GiaContributionConfig> = {
  type: "giaContribution",
  displayName: "GIA contribution",
  description: "A contribution into a General Investment Account",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(giaContributionDefinition);
