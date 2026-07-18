import { zeroPence, type Pence } from "../money/pence.js";

/**
 * Private Residence Relief (SPEC.md §5.6) — a full CGT exemption on the
 * sale of a qualifying main home. v1 assumes, as the spec explicitly
 * permits as the default/common case, that the property was the
 * person's (or household's) only/main residence throughout its whole
 * ownership period, so relief is always total. Kept as its own function
 * (rather than folded into the general CGT calculation) so this
 * assumption is visible and independently testable, and so the tax
 * breakdown view can name PRR as the specific reason no CGT was charged
 * rather than silently applying relief.
 */
export function applyPrivateResidenceRelief(_gain: Pence): Pence {
  return zeroPence();
}
