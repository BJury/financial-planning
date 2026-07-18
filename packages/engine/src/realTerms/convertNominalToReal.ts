/**
 * Converts a nominal rate of return to a real (inflation-adjusted) rate
 * via the Fisher equation (SPEC.md §3.10, §5.8) — not the crude
 * `nominal - inflation` subtraction, which is a reasonable approximation
 * at low rates but visibly wrong at higher ones.
 *
 * A plain `number`, not `Pence` — a rate has nothing to do with money
 * until it's later applied to an amount via `multiplyPenceByRate`.
 */
export function convertNominalToReal(nominalRate: number, inflationRate: number): number {
  return (1 + nominalRate) / (1 + inflationRate) - 1;
}

/**
 * The inverse of `convertNominalToReal` — recovers the nominal rate that
 * would produce a given real rate at a given inflation assumption. Used
 * only for *display*: the engine always stores and simulates with real
 * rates (SPEC.md §5.8), but a UI showing that stored value back to a
 * user is more intuitive in the nominal terms they originally thought
 * in, so this converts it back for that purpose.
 */
export function convertRealToNominal(realRate: number, inflationRate: number): number {
  return (1 + realRate) * (1 + inflationRate) - 1;
}
