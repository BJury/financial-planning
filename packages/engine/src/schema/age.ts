/**
 * A person's age in whole years as of a given calendar year (their
 * birthday within that year having already passed) — used by every
 * catalog type's `isActive` check (e.g. "has this Salary's end age been
 * reached").
 */
export function ageAtYear(dateOfBirth: string, calendarYear: number): number {
  const birthYear = new Date(dateOfBirth).getUTCFullYear();
  return calendarYear - birthYear;
}
