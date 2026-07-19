import { maxPence, subtractPence, zeroPence, type Pence } from "../money/pence.js";

/**
 * A drawdown target represents *total* desired income, not "how much
 * extra to draw on top of everything else" (SPEC.md §5.7.2: "if
 * automatic income already meets or exceeds the target, no discretionary
 * drawdown is needed"). Given how much a person is already receiving
 * this year from every other source — salary, rental profit, State
 * Pension, tax-free income, property-sale net proceeds, net of Income
 * Tax/NI/Annual Allowance charge already finalised for them — this
 * shrinks the target to just the remaining gap that actually needs to
 * come from a pension/ISA/GIA/cash withdrawal. Never goes negative: if
 * other income already meets or exceeds the target, nothing further is
 * drawn.
 */
export function adjustDrawdownTargetForAutomaticIncome(target: Pence, otherNetIncomeAlreadyReceivable: Pence): Pence {
  return maxPence(subtractPence(target, otherNetIncomeAlreadyReceivable), zeroPence());
}
