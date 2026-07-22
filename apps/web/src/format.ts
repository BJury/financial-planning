import { penceToPounds, type Pence } from "@fp/engine";

// `Number.prototype.toLocaleString` builds a brand-new `Intl.NumberFormat`
// internally on *every single call* — a well-known JS perf trap. The
// year-by-year table alone calls one of these formatters for every money
// cell, on every row, on every render (SPEC.md §9.7's perf budget), so
// that cost multiplies fast. Reusing one instance per format shape avoids
// it entirely — `Intl.NumberFormat#format` is cheap; only construction is
// expensive.
const MONEY_FORMATTER = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const MONEY_FORMATTER_ROUNDED = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });
const PLAIN_NUMBER_FORMATTER = new Intl.NumberFormat(undefined);
const PERCENT_FORMATTER = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function formatMoney(amount: Pence | undefined): string {
  if (amount === undefined) return "—";
  return `£${MONEY_FORMATTER.format(penceToPounds(amount))}`;
}

/** For a value already in pounds (not Pence) — e.g. a chart metric, which already converts for plotting. */
export function formatPoundsMoney(amountInPounds: number): string {
  return `£${MONEY_FORMATTER.format(amountInPounds)}`;
}

/** No decimal places — for a chart axis tick or tooltip, where cents are just noise. */
export function formatMoneyRounded(amountInPounds: number): string {
  return `£${MONEY_FORMATTER_ROUNDED.format(amountInPounds)}`;
}

/** The same default formatting `Number.prototype.toLocaleString()` gives with no options — via the shared, reused formatter above. */
export function formatNumber(n: number): string {
  return PLAIN_NUMBER_FORMATTER.format(n);
}

export function formatPercent(rate: number): string {
  return `${PERCENT_FORMATTER.format(rate * 100)}%`;
}
