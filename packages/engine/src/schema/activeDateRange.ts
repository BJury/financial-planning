/**
 * Whether a calendar year falls within an optional start/end date range —
 * the generic scheduling every Income Source/Drain instance carries
 * (SPEC.md §3.11), independent of any type-specific `isActive` check
 * (e.g. Salary's age-based `endAge`). Lets a rental income starting in 5
 * years and running for 10, say, be expressed without every catalog type
 * having to implement its own start/end-date handling.
 *
 * Only the *year* component is compared, matching the engine's whole-tax-year
 * granularity elsewhere (e.g. `ageAtYear`) — no mid-year proration.
 */
export function isWithinActiveDateRange(startDate: string | undefined, endDate: string | undefined, calendarYear: number): boolean {
  if (startDate !== undefined && calendarYear < new Date(startDate).getUTCFullYear()) {
    return false;
  }
  if (endDate !== undefined && calendarYear > new Date(endDate).getUTCFullYear()) {
    return false;
  }
  return true;
}
