import { isNegative, type Pence } from "../../money/pence.js";
import { ageAtYear } from "../../schema/age.js";
import { DEFAULT_STATE_PENSION_AGE, type Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type { CatalogFieldSchema, IncomeSourceDefinition, ScenarioState, ValidationIssue, YearContext } from "../types.js";

export interface StatePensionConfig {
  /**
   * This person's own State Pension forecast, already annualised and in
   * today's money (SPEC.md §3.3) — from their gov.uk "Check your State
   * Pension forecast" page, the primary, recommended source. A flat real
   * amount every year once claimed (no separate growth-rate field): this
   * engine treats every input as already real, so the simplest, most
   * consistent v1 baseline is that State Pension keeps pace with
   * inflation exactly, matching how the rest of this engine's "real
   * terms throughout" convention already treats amounts with no explicit
   * growth rate of their own.
   */
  readonly annualForecastAmount: Pence;
}

const fields: readonly CatalogFieldSchema<StatePensionConfig>[] = [
  {
    key: "annualForecastAmount",
    label: "Annual State Pension forecast",
    input: "currency",
    required: true,
  },
];

function validate(config: Readonly<StatePensionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualForecastAmount)) {
    issues.push({ field: "annualForecastAmount", tier: "hardBlock", message: "Annual State Pension forecast cannot be negative." });
  }

  return issues;
}

/**
 * Gated on this person's own State Pension Age (`Person.statePensionAge`,
 * falling back to `DEFAULT_STATE_PENSION_AGE` — SPEC.md §3.3), never a
 * per-instance field: SPA is a property of the person, not of any one
 * catalog instance, and the same figure also gates the NI cutoff in
 * `simulation/runProjection.ts` (SPEC.md §5.3). State Pension is
 * explicitly never jointly owned (SPEC.md §3.3: "there is no joint/shared
 * State Pension... always calculated per person from their own NI
 * record") — `owner` here is always expected to be a specific `PersonId`,
 * enforced by the UI rather than re-checked here (matching how pensions/
 * ISAs are already UI-restricted to person-only ownership).
 */
function isActive(_config: Readonly<StatePensionConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): boolean {
  const person = state.scenario.household.people.find((p) => p.id === owner);
  if (!person) return false;
  return ageAtYear(person.dateOfBirth, yearContext.calendarYear) >= (person.statePensionAge ?? DEFAULT_STATE_PENSION_AGE);
}

function calculateForYear(config: Readonly<StatePensionConfig>, _state: ScenarioState, _yearContext: YearContext, _owner: Owner) {
  return {
    kind: "simple" as const,
    amount: config.annualForecastAmount,
    taxCategory: "statePensionIncome" as const,
  };
}

export const statePensionDefinition: IncomeSourceDefinition<StatePensionConfig> = {
  type: "statePension",
  displayName: "State Pension",
  description: "Paid gross once you reach State Pension age — taxable at your marginal rate, but never subject to National Insurance",
  taxCategory: "statePensionIncome",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(statePensionDefinition);
