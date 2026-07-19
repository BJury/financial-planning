import { compoundPenceByRate, isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeSourceDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export interface SalaryConfig {
  /** Current gross annual salary, already in today's terms (SPEC.md §3.2). */
  readonly grossAnnualSalary: Pence;
  /**
   * Already a *real* rate (SPEC.md §3.10, §5.8) — the UI converts the
   * user's nominal input to real once, at the point of entry; this
   * engine module never sees a nominal rate or an inflation figure.
   */
  readonly annualGrowthRate: number;
}

const fields: readonly CatalogFieldSchema<SalaryConfig>[] = [
  { key: "grossAnnualSalary", label: "Gross annual salary", input: "currency", required: true },
  { key: "annualGrowthRate", label: "Expected annual growth", input: "growthRate", required: true },
];

function validate(config: Readonly<SalaryConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  // Hard block: a negative salary is structurally meaningless (SPEC.md §3.12).
  if (isNegative(config.grossAnnualSalary)) {
    issues.push({
      field: "grossAnnualSalary",
      tier: "hardBlock",
      message: "Gross annual salary cannot be negative.",
    });
  }

  // Soft warning: an extreme growth assumption is unusual but not invalid
  // — a deliberate stress test is a legitimate use case (SPEC.md §3.12).
  if (config.annualGrowthRate > 0.2 || config.annualGrowthRate < -0.2) {
    issues.push({
      field: "annualGrowthRate",
      tier: "softWarning",
      message: "This growth rate is unusually large — double-check it wasn't meant to be entered as a percentage (e.g. 3 instead of 0.03).",
    });
  }

  return issues;
}

function isActive(_config: Readonly<SalaryConfig>, state: ScenarioState, _yearContext: YearContext, owner: Owner): boolean {
  if (owner === "joint") {
    // A Salary can never actually be owned jointly (SPEC.md §3.2 — salary
    // is always an individual Person's employment income), but the type
    // system allows Owner='joint' generically; treat it as inactive
    // rather than throwing, since validate() is what should catch this
    // misconfiguration before it ever reaches calculateForYear/isActive.
    return false;
  }
  return state.scenario.household.people.some((p) => p.id === owner);
}

function calculateForYear(config: Readonly<SalaryConfig>, _state: ScenarioState, yearContext: YearContext, _owner: Owner) {
  return {
    kind: "simple" as const,
    amount: compoundPenceByRate(config.grossAnnualSalary, config.annualGrowthRate, yearContext.yearIndex),
    taxCategory: "earnedIncome" as const,
  };
}

export const salaryDefinition: IncomeSourceDefinition<SalaryConfig> = {
  type: "salary",
  displayName: "Salary",
  description: "Employment income",
  taxCategory: "earnedIncome",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(salaryDefinition);
