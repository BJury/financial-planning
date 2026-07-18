import { isNegative, type Pence } from "../../money/pence.js";
import { ageAtYear } from "../../schema/age.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeSourceDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export interface TargetDrawdownIncomeConfig {
  /** How much net (after-tax) income this person wants this year, in today's money (SPEC.md §5.7.1). */
  readonly targetNetAnnualIncome: Pence;
  /** Defaults, in the UI, to the owner's target retirement age (SPEC.md §5.7.1). */
  readonly startAge: number;
  /** Optional — e.g. a step-down at State Pension age is modelled as a second instance starting where this one ends. */
  readonly endAge?: number;
  /** The pension account this target draws from, if any (v1 scope: at most one). */
  readonly pensionAccountId?: string;
  /** The ISA account this target draws from, if any (v1 scope: at most one). */
  readonly isaAccountId?: string;
  /** The cash account this target draws from, if any (v1 scope: at most one). */
  readonly cashAccountId?: string;
  /** The GIA this target draws from, if any (v1 scope: at most one). */
  readonly giaAccountId?: string;
}

const fields: readonly CatalogFieldSchema<TargetDrawdownIncomeConfig>[] = [
  { key: "targetNetAnnualIncome", label: "Target net annual income", input: "currency", required: true },
  { key: "startAge", label: "Starts at age", input: "age", required: true },
  { key: "endAge", label: "Ends at age", input: "age", required: false },
  { key: "pensionAccountId", label: "Pension account to draw from", input: "select", required: false },
  { key: "isaAccountId", label: "ISA account to draw from", input: "select", required: false },
  { key: "cashAccountId", label: "Cash account to draw from", input: "select", required: false },
  { key: "giaAccountId", label: "GIA to draw from", input: "select", required: false },
];

function validate(config: Readonly<TargetDrawdownIncomeConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.targetNetAnnualIncome)) {
    issues.push({
      field: "targetNetAnnualIncome",
      tier: "hardBlock",
      message: "Target net annual income cannot be negative.",
    });
  }

  if (
    config.pensionAccountId === undefined &&
    config.isaAccountId === undefined &&
    config.cashAccountId === undefined &&
    config.giaAccountId === undefined
  ) {
    issues.push({
      field: "pensionAccountId",
      tier: "softWarning",
      message: "No account selected — this target has nothing to draw from.",
    });
  }

  if (config.endAge !== undefined && config.endAge <= config.startAge) {
    issues.push({
      field: "endAge",
      tier: "hardBlock",
      message: "End age must be after the start age.",
    });
  }

  return issues;
}

function isActive(config: Readonly<TargetDrawdownIncomeConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): boolean {
  if (owner === "joint") {
    // A drawdown target can be scoped to a specific person only in v1 —
    // household-combined targets are SPEC.md §5.7.4, deferred to Phase 5.
    return false;
  }
  const person = state.scenario.household.people.find((p) => p.id === owner);
  if (!person) {
    return false;
  }
  const age = ageAtYear(person.dateOfBirth, yearContext.calendarYear);
  if (age < config.startAge) {
    return false;
  }
  return config.endAge === undefined || age < config.endAge;
}

/**
 * A standalone, best-effort approximation only — see
 * `simulation/runProjection.ts`, which is where this type's income is
 * *actually* computed for a real simulation via `drawdown/solveDrawdown.ts`.
 * Unlike every other catalog type, a correct drawdown calculation needs
 * this year's Income Tax bands and this person's *other* income to know
 * which marginal rate the next pound of withdrawal lands in — neither is
 * available from this function's signature (catalog types deliberately
 * never see tax-year data, SPEC.md §9.1/§9.4), so `runProjection`
 * special-cases this type the same way it already special-cases
 * account-crediting for pension/ISA drains. This function exists so the
 * type is still registry-complete and its fields/validate/isActive wiring
 * is independently testable; it reports the target amount achieved with
 * an empty bucket breakdown, since it cannot honestly compute one.
 */
function calculateForYear(
  config: Readonly<TargetDrawdownIncomeConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    kind: "bucketed" as const,
    totalAmount: config.targetNetAnnualIncome,
    buckets: [],
  };
}

export const targetDrawdownIncomeDefinition: IncomeSourceDefinition<TargetDrawdownIncomeConfig> = {
  type: "targetDrawdownIncome",
  displayName: "Drawdown income target",
  description: "How much net income you want to draw each year in retirement — the engine works out the most tax-efficient mix of pension and ISA withdrawals to hit it",
  taxCategory: "pensionIncome",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(targetDrawdownIncomeDefinition);
