import { subtractPence, type Pence } from "../../money/pence.js";

/**
 * Salary sacrifice: the contribution is deducted from gross salary
 * before *both* Income Tax and NI are calculated — relief at the
 * person's marginal rate on both (SPEC.md §5.4). This is the main
 * quantitative advantage of salary sacrifice over relief-at-source: an
 * actual NI saving, not just an Income Tax one (§5.3). The pension pot
 * receives the sacrificed amount at face value, same as net pay.
 */
export function applySalarySacrifice(income: Pence, sacrificeAmount: Pence): Pence {
  return subtractPence(income, sacrificeAmount);
}
