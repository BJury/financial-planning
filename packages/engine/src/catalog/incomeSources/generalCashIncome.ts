import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeSourceDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export interface GeneralCashIncomeConfig {
  readonly amount: Pence;
  /**
   * An ISA, GIA, cash, or pension `Account.id` this income is paid
   * straight into every active year — resolved and credited in
   * `simulation/runProjection.ts` (a catalog type's own
   * `calculateForYear` never sees account balances, SPEC.md §9.1/§9.4,
   * the same reason `oneOffInflow`'s own destination is too). Unlike
   * `oneOffInflow`'s *optional* destination, this one is required —
   * there's no separate "just becomes spendable cash" option, since
   * picking the Cash account kind already covers that; this type recurs
   * every year rather than landing once, so leaving it undirected would
   * mean choosing a destination account every single year by hand
   * instead of once. An ISA destination is capped at the owner's
   * remaining annual subscription limit (shared with any manual ISA
   * contribution drain, a destination-directed one-off inflow, and the
   * surplus sweep, all drawing on the same pool) — any excess becomes
   * ordinary spendable cash for that year rather than being lost. GIA,
   * cash, and pension destinations have no cap; a pension destination is
   * credited at face value with no relief-at-source uplift and no Annual
   * Allowance impact, since this is already tax-free money being
   * invested, not a new pension contribution (SPEC.md §3.4's relief
   * methods are for money that hasn't been received as income yet).
   */
  readonly destinationAccountId: string;
}

const fields: readonly CatalogFieldSchema<GeneralCashIncomeConfig>[] = [
  { key: "amount", label: "Annual amount", input: "currency", required: true },
  { key: "destinationAccountId", label: "Pay into", input: "select", required: true },
];

function validate(config: Readonly<GeneralCashIncomeConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Hard block: a negative amount is structurally meaningless (SPEC.md §3.12).
  if (isNegative(config.amount)) {
    issues.push({ field: "amount", tier: "hardBlock", message: "Amount cannot be negative." });
  }
  if (!config.destinationAccountId) {
    issues.push({ field: "destinationAccountId", tier: "hardBlock", message: "A destination account is required." });
  }

  return issues;
}

function isActive(_config: Readonly<GeneralCashIncomeConfig>, _state: ScenarioState, _yearContext: YearContext, _owner: Owner): boolean {
  // No extra condition beyond the generic owner-match + startDate/endDate
  // scheduling every instance already gets (SPEC.md §3.11) — unlike
  // Salary, this can legitimately be jointly owned (e.g. a shared gift).
  return true;
}

/**
 * Always tax-free, unlike Salary/State Pension/rental profit — for cash
 * already received with no further tax due (a regular gift, an
 * already-taxed annuity, and so on), not a way to reclassify otherwise-
 * taxable income; a source that's actually taxable belongs in one of the
 * other catalog types instead.
 */
function calculateForYear(config: Readonly<GeneralCashIncomeConfig>, _state: ScenarioState, _yearContext: YearContext, _owner: Owner) {
  return {
    kind: "simple" as const,
    amount: config.amount,
    taxCategory: "taxFree" as const,
  };
}

export const generalCashIncomeDefinition: IncomeSourceDefinition<GeneralCashIncomeConfig> = {
  type: "generalCashIncome",
  displayName: "General cash income",
  description: "Recurring tax-free cash — a gift, an already-taxed annuity, and so on — paid into a chosen account",
  taxCategory: "taxFree",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(generalCashIncomeDefinition);
