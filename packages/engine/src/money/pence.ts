import { roundHalfAwayFromZero } from "./rounding.js";

/**
 * All monetary values in this engine are represented as integer pence,
 * never floating-point pounds (SPEC.md §9.6) — IEEE 754 floats cannot
 * represent amounts like £0.10 exactly, and that error compounds across
 * a 50-year, many-account simulation into wrong penny-level results.
 *
 * `Pence` is a branded primitive (not a wrapper class) so it erases to a
 * plain `number` at compile time (zero runtime cost), survives
 * `structuredClone`/`postMessage`/JSON serialisation with no custom
 * (de)serialiser, and still stops a raw `number` (pounds, a rate, an
 * array index) being passed where pence is expected.
 */
export type Pence = number & { readonly __brand: "Pence" };

/** Asserts `value` is a whole number of pence and brands it as such. */
export function pence(value: number): Pence {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Pence must be a finite integer, got ${value}`);
  }
  return value as Pence;
}

export function zeroPence(): Pence {
  return pence(0);
}

/** The only place a pounds float becomes Pence — an input-boundary conversion (§9.6). */
export function poundsToPence(pounds: number): Pence {
  return pence(roundHalfAwayFromZero(pounds * 100));
}

/** The only place Pence becomes a pounds float — a display-boundary conversion (§9.6). */
export function penceToPounds(amount: Pence): number {
  return amount / 100;
}

export function addPence(a: Pence, b: Pence): Pence {
  return pence(a + b);
}

export function subtractPence(a: Pence, b: Pence): Pence {
  return pence(a - b);
}

export function sumPence(values: readonly Pence[]): Pence {
  return pence(values.reduce((total: number, v) => total + v, 0));
}

export function maxPence(a: Pence, b: Pence): Pence {
  return a > b ? a : b;
}

export function minPence(a: Pence, b: Pence): Pence {
  return a < b ? a : b;
}

export function isNegative(amount: Pence): boolean {
  return amount < 0;
}

/**
 * The one chokepoint where a rate (0–1, kept at full float precision
 * throughout a calculation chain per §9.6) is applied to a monetary
 * amount and rounded to the penny. Every calculation function that
 * needs "amount * rate" should call this rather than rounding inline,
 * so rounding behaviour can never drift between call sites.
 */
export function multiplyPenceByRate(amount: Pence, rate: number): Pence {
  return pence(roundHalfAwayFromZero(amount * rate));
}

/** Grows an amount by a single year's rate — `amount * (1 + rate)`, rounded to the penny. */
export function growPenceByRate(amount: Pence, rate: number): Pence {
  return multiplyPenceByRate(amount, 1 + rate);
}

/**
 * Compounds an amount by a rate over a whole number of periods —
 * `amount * (1 + rate) ^ periods`, rounded once at the end. Shared by
 * anything that grows a real-terms value across simulated years without
 * threading state year-by-year (e.g. uprating a threshold by elapsed
 * years, or a catalog type computing its current-year amount directly
 * from a base value and an elapsed year count).
 */
export function compoundPenceByRate(amount: Pence, rate: number, periods: number): Pence {
  const factor = Math.pow(1 + rate, periods);
  return pence(roundHalfAwayFromZero(amount * factor));
}
