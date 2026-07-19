import {
  ageAtYear,
  DEFAULT_PROJECTION_YEARS,
  getLatestConfirmedRuleSet,
  runProjection,
  subtractPence,
  sumPence,
  type Pence,
  type ProjectionResult,
  type Scenario,
  type YearLedgerRow,
} from "@fp/engine";

/**
 * The projection's natural full length runs to the latest of any
 * household member's own `projectionEndAge` (SPEC.md §3.2) — since a
 * scheduled item (a rental starting in 5 years and running for 10, say)
 * can easily fall entirely outside a hardcoded few-year horizon. The
 * user-facing `Scenario.projectionYears` (defaulting to
 * `DEFAULT_PROJECTION_YEARS`) can *shorten* this to something more
 * readable than "however long until everyone's assumed lifespan ends,"
 * but deliberately never lengthens it past that natural maximum —
 * showing years after everyone's own modelled death is meaningless
 * (survivorship's own `alivePeople` filtering has no defined behaviour
 * once nobody's left in it), so the two bounds are combined with `min`,
 * not used as alternatives.
 */
export function projectionYearsFor(scenario: Scenario, startCalendarYear: number): number {
  const yearsPerPerson = scenario.household.people.map((p) => p.projectionEndAge - ageAtYear(p.dateOfBirth, startCalendarYear));
  const naturalMax = Math.max(1, ...yearsPerPerson);
  const requested = scenario.projectionYears ?? DEFAULT_PROJECTION_YEARS;
  return Math.max(1, Math.min(requested, naturalMax));
}

/**
 * The single computation every page that shows projection results calls
 * — the results pane and the tax breakdown view must always be looking
 * at exactly the same numbers, since cross-checking one against the
 * other is the whole point of the tax breakdown view.
 */
export function computeProjection(scenario: Scenario): ProjectionResult {
  const confirmedRuleSet = getLatestConfirmedRuleSet();
  const startCalendarYear = new Date(confirmedRuleSet.effectiveFrom).getUTCFullYear();
  return runProjection(scenario, confirmedRuleSet, projectionYearsFor(scenario, startCalendarYear));
}

/**
 * `accountBalances` holds each property's own market *value* — net worth
 * (SPEC.md §7's "property equity net of mortgage") also needs to
 * subtract whatever's still owed against it.
 */
export function computeNetWorth(row: YearLedgerRow): Pence {
  return subtractPence(sumPence([...row.accountBalances.values()]), sumPence([...row.mortgageBalanceByPropertyId.values()]));
}
