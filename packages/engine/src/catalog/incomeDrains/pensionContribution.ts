import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeDrainDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

/**
 * Phase 1 scope: relief-at-source only (SPEC.md §13 Phase 1). Net-pay
 * and salary-sacrifice relief mechanisms are added in Phase 2 as
 * additional `reliefMethod` values — the config shape already
 * anticipates this so adding them later doesn't reshape this type.
 */
export type PensionReliefMethod = "reliefAtSource";

export interface PensionContributionConfig {
  /** Which pension `Account.id` this contribution funds. */
  readonly pensionAccountId: string;
  readonly reliefMethod: PensionReliefMethod;
  /** The amount actually paid from net pay, before the provider's basic-rate top-up (SPEC.md §5.4). */
  readonly annualContribution: Pence;
}

const fields: readonly CatalogFieldSchema<PensionContributionConfig>[] = [
  { key: "pensionAccountId", label: "Pension account", input: "select", required: true },
  { key: "reliefMethod", label: "Relief method", input: "select", required: true },
  { key: "annualContribution", label: "Annual contribution (net pay)", input: "currency", required: true },
];

function validate(config: Readonly<PensionContributionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualContribution)) {
    issues.push({
      field: "annualContribution",
      tier: "hardBlock",
      message: "Pension contribution cannot be negative.",
    });
  }

  return issues;
}

function isActive(_config: Readonly<PensionContributionConfig>, _state: ScenarioState, _yearContext: YearContext, _owner: Owner): boolean {
  // Phase 1: a contribution is active for every simulated year it's
  // configured for — start/end-age bounding (e.g. stopping contributions
  // at retirement) is added alongside the drawdown phase in Phase 4.
  return true;
}

function calculateForYear(
  config: Readonly<PensionContributionConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.annualContribution,
    taxTreatment: "reliefAtSourceBasicRateTopUp" as const,
  };
}

export const pensionContributionDefinition: IncomeDrainDefinition<PensionContributionConfig> = {
  type: "pensionContribution",
  displayName: "Pension contribution",
  description: "A contribution into a pension account",
  taxTreatment: "reliefAtSourceBasicRateTopUp",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(pensionContributionDefinition);
