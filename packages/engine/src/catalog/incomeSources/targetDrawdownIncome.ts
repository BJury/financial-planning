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

export type HouseholdDrawdownSplitStrategy = "optimised" | "even" | "custom";

export interface TargetDrawdownIncomeConfig {
  /** How much net (after-tax) income this person (or household, if jointly owned) wants this year, in today's money (SPEC.md §5.7.1). */
  readonly targetNetAnnualIncome: Pence;
  /** Defaults, in the UI, to the owner's target retirement age (SPEC.md §5.7.1). For a joint target, gated on the first household member's age — a documented v1 convention (SPEC.md §5.7.4). */
  readonly startAge: number;
  /** Optional — e.g. a step-down at State Pension age is modelled as a second instance starting where this one ends. */
  readonly endAge?: number;
  /** The pension account this target draws from, if any (v1 scope: at most one). Ignored for a joint target — see `simulation/runProjection.ts`'s account auto-discovery. */
  readonly pensionAccountId?: string;
  /** The ISA account this target draws from, if any (v1 scope: at most one). Ignored for a joint target. */
  readonly isaAccountId?: string;
  /** The cash account this target draws from, if any (v1 scope: at most one). Ignored for a joint target. */
  readonly cashAccountId?: string;
  /** The GIA this target draws from, if any (v1 scope: at most one). Ignored for a joint target. */
  readonly giaAccountId?: string;
  /** Only meaningful for a jointly-owned target (SPEC.md §5.7.4) — how the combined target is split between the two people. Defaults to `"optimised"` if omitted. */
  readonly householdSplitStrategy?: HouseholdDrawdownSplitStrategy;
  /** Only used when `householdSplitStrategy` is `"custom"` — the first household member's share of the target, as a 0-1 fraction (SPEC.md §9.6's "percentage" input convention: stored as a fraction, displayed as %). */
  readonly customFirstPersonShare?: number;
}

const fields: readonly CatalogFieldSchema<TargetDrawdownIncomeConfig>[] = [
  { key: "targetNetAnnualIncome", label: "Target net annual income", input: "currency", required: true },
  { key: "startAge", label: "Starts at age", input: "age", required: true },
  { key: "endAge", label: "Ends at age", input: "age", required: false },
  { key: "pensionAccountId", label: "Pension account to draw from", input: "select", required: false },
  { key: "isaAccountId", label: "ISA account to draw from", input: "select", required: false },
  { key: "cashAccountId", label: "Cash account to draw from", input: "select", required: false },
  { key: "giaAccountId", label: "GIA to draw from", input: "select", required: false },
  {
    key: "householdSplitStrategy",
    label: "How to split between you",
    input: "select",
    required: false,
    options: [
      { value: "optimised", label: "Optimised (lowest total tax)" },
      { value: "even", label: "Even split" },
      { value: "custom", label: "Custom split" },
    ],
  },
  { key: "customFirstPersonShare", label: "Your share", input: "percentage", required: false },
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

  // Not checked here whether *no* account is selected (unlike earlier
  // versions of this type): a joint target auto-discovers each person's
  // own accounts (SPEC.md §5.7.4) rather than requiring explicit
  // selection, and `validate` has no way to see this instance's own
  // `owner` to distinguish the two cases (SPEC.md §9.4's plugin
  // signature is deliberately owner-agnostic here).

  if (config.endAge !== undefined && config.endAge <= config.startAge) {
    issues.push({
      field: "endAge",
      tier: "hardBlock",
      message: "End age must be after the start age.",
    });
  }

  return issues;
}

/**
 * For a joint target, start/end age is gated on the *first* household
 * member's age (`household.people[0]`) — a documented v1 convention
 * (SPEC.md §5.7.4 doesn't specify one), rather than requiring both
 * people to reach the same age or introducing a second age field.
 */
function isActive(config: Readonly<TargetDrawdownIncomeConfig>, state: ScenarioState, yearContext: YearContext, owner: Owner): boolean {
  const person = owner === "joint" ? state.scenario.household.people[0] : state.scenario.household.people.find((p) => p.id === owner);
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
