function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * A UK tax year runs 6 April to 5 April, so any leap day it contains falls
 * in the February/March at its *end* — the calendar year after
 * `taxYearStartCalendarYear`, not that calendar year itself (e.g. tax year
 * 2023-24 contains 29 Feb 2024, not any date in 2023).
 */
export function daysInTaxYear(taxYearStartCalendarYear: number): number {
  return isLeapYear(taxYearStartCalendarYear + 1) ? 366 : 365;
}

/**
 * Converts an annual return to the daily rate that compounds to it over
 * `days`, then compounds that daily rate back up to a year — i.e. routes
 * the return through an explicit "return per day" step rather than
 * applying it as a single annual multiplication directly. Mathematically
 * this reproduces `annualRate` (to floating-point precision): "annualised"
 * literally means the daily rate is *defined* as whatever compounds to the
 * annual figure over the year, so this transform cannot itself change a
 * simulated outcome. It exists so the stochastic simulation generates and
 * applies a genuine daily return series (`runStochasticTrajectory.ts`)
 * rather than treating each year as a single lump step, even though the
 * two are numerically equivalent for a rate applied uniformly across the
 * whole year with no cash flow landing mid-year to prorate against.
 */
export function annualReturnViaDailyRate(annualRate: number, days: number): number {
  const dailyRate = Math.pow(1 + annualRate, 1 / days) - 1;
  return Math.pow(1 + dailyRate, days) - 1;
}
