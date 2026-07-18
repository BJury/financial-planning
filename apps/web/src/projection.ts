import { ageAtYear, getLatestConfirmedRuleSet, runProjection, type ProjectionResult, type Scenario } from "@fp/engine";

/**
 * The projection runs to the latest of any household member's own
 * `projectionEndAge` (SPEC.md §3.2) — not a fixed short window — since a
 * scheduled item (a rental starting in 5 years and running for 10, say)
 * can easily fall entirely outside a hardcoded few-year horizon.
 */
export function projectionYearsFor(scenario: Scenario, startCalendarYear: number): number {
  const yearsPerPerson = scenario.household.people.map((p) => p.projectionEndAge - ageAtYear(p.dateOfBirth, startCalendarYear));
  return Math.max(1, ...yearsPerPerson);
}

/**
 * The single computation every page that shows projection results calls
 * — Dashboard and the tax breakdown view must always be looking at
 * exactly the same numbers, since cross-checking one against the other
 * is the whole point of the tax breakdown view.
 */
export function computeProjection(scenario: Scenario): ProjectionResult {
  const confirmedRuleSet = getLatestConfirmedRuleSet();
  const startCalendarYear = new Date(confirmedRuleSet.effectiveFrom).getUTCFullYear();
  return runProjection(scenario, confirmedRuleSet, projectionYearsFor(scenario, startCalendarYear));
}
