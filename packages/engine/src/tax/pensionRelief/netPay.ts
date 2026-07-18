import { subtractPence, type Pence } from "../../money/pence.js";

/**
 * Net pay arrangement: the contribution is deducted from gross salary
 * before Income Tax is calculated — full relief automatically, at
 * whatever the person's marginal rate turns out to be once the reduced
 * taxable income is banded. No effect on NI (SPEC.md §5.4). The pension
 * pot receives the contribution at face value — no gross-up, unlike
 * relief-at-source (§9.3: kept as its own function precisely because
 * this NI/tax interaction differs from every other relief mechanism).
 */
export function applyNetPayRelief(taxableIncome: Pence, contribution: Pence): Pence {
  return subtractPence(taxableIncome, contribution);
}
