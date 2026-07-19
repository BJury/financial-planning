/**
 * Whether a calendar year falls within an optional start/end date range —
 * the generic scheduling every Income Source/Drain instance carries
 * (SPEC.md §3.11), independent of any type-specific `isActive` check
 * (e.g. Salary's age-based `endAge`). Lets a rental income starting in 5
 * years and running for 10, say, be expressed without every catalog type
 * having to implement its own start/end-date handling. Also reused
 * directly by `oneOffInflow`/`oneOffOutflow`'s own `isActive`, passing
 * their single required `date` field as both bounds, to restrict to
 * exactly the one tax year it falls in.
 *
 * Only the *year* component is compared, matching the engine's whole-tax-year
 * granularity elsewhere (e.g. `ageAtYear`) — no mid-year proration.
 *
 * An unparseable bound (`new Date(x).getUTCFullYear()` is `NaN` — e.g. a
 * required date field a user hasn't filled in yet, still `""` from
 * `createDefaultConfig`) is treated as *not yet active*, not "no
 * restriction": `NaN` comparisons (`year < NaN`, `year > NaN`) are always
 * `false` in JavaScript, so leaving this unguarded made an incomplete
 * `oneOffInflow`/`oneOffOutflow` silently active in *every* year instead
 * of none — a real bug, caught from a user report of a one-off inflow
 * they hadn't set a date on yet appearing as recurring income.
 */
export function isWithinActiveDateRange(startDate: string | undefined, endDate: string | undefined, calendarYear: number): boolean {
  if (startDate !== undefined) {
    const startYear = new Date(startDate).getUTCFullYear();
    if (Number.isNaN(startYear) || calendarYear < startYear) return false;
  }
  if (endDate !== undefined) {
    const endYear = new Date(endDate).getUTCFullYear();
    if (Number.isNaN(endYear) || calendarYear > endYear) return false;
  }
  return true;
}
