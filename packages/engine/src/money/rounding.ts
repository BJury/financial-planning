/**
 * Rounds a raw (possibly fractional) pence value to the nearest whole
 * penny using round-half-away-from-zero — HMRC's convention applied
 * symmetrically to signed values (SPEC.md §9.6, §11 risk on negative
 * pence: a shortfall or a loss can legitimately be negative, and it must
 * round the same distance from zero as its positive counterpart, not
 * silently round toward positive infinity via a plain `Math.floor`).
 *
 * Examples: 0.5 -> 1, -0.5 -> -1, 1.4 -> 1, -1.4 -> -1, 1.5 -> 2, -1.5 -> -2.
 */
export function roundHalfAwayFromZero(raw: number): number {
  // `|| 0` normalises -0 to 0 (e.g. rounding -0.1) so downstream equality
  // checks and display formatting never have to special-case negative zero.
  return Math.sign(raw) * Math.floor(Math.abs(raw) + 0.5) || 0;
}
