import { isNegative, type Pence } from "../../money/pence.js";
import type { Owner } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeDrainDefinition,
  ScenarioState,
  TaxTreatment,
  ValidationIssue,
  YearContext,
} from "../types.js";

export type PensionReliefMethod = "reliefAtSource" | "netPay" | "salarySacrifice";

export interface PensionContributionConfig {
  /** Which pension `Account.id` this contribution funds. */
  readonly pensionAccountId: string;
  readonly reliefMethod: PensionReliefMethod;
  /**
   * For `reliefAtSource`: the amount actually paid from net pay, before
   * the provider's basic-rate top-up. For `netPay`/`salarySacrifice`:
   * the full amount deducted from gross salary (SPEC.md §5.4) — the
   * pension pot receives this figure at face value for both, with no
   * separate gross-up step, since relief is already given by reducing
   * taxable (and, for salary sacrifice, NIable) income directly.
   */
  readonly annualContribution: Pence;
}

const RELIEF_METHOD_TO_TAX_TREATMENT: Record<PensionReliefMethod, TaxTreatment> = {
  reliefAtSource: "reliefAtSourceBasicRateTopUp",
  netPay: "reducesTaxableIncomeNetPay",
  salarySacrifice: "reducesTaxableIncomeAndNISalarySacrifice",
};

const fields: readonly CatalogFieldSchema<PensionContributionConfig>[] = [
  { key: "pensionAccountId", label: "Pension account", input: "select", required: true },
  {
    key: "reliefMethod",
    label: "Relief method",
    input: "select",
    required: true,
    options: [
      { value: "reliefAtSource", label: "Relief at source (paid from net pay)" },
      { value: "netPay", label: "Net pay (deducted from gross salary)" },
      { value: "salarySacrifice", label: "Salary sacrifice (also reduces NI)" },
    ],
  },
  { key: "annualContribution", label: "Annual contribution", input: "currency", required: true },
];

function validate(config: Readonly<PensionContributionConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (isNegative(config.annualContribution)) {
    issues.push({
      field: "annualContribution",
      tier: "hardBlock",
      message: "Pension contribution cannot be negative.",
    });
  }

  return issues;
}

function isActive(_config: Readonly<PensionContributionConfig>, _state: ScenarioState, _yearContext: YearContext, _owner: Owner): boolean {
  // Phase 1: a contribution is active for every simulated year it's
  // configured for — start/end-age bounding (e.g. stopping contributions
  // at retirement) is added alongside the drawdown phase in Phase 4.
  return true;
}

function calculateForYear(
  config: Readonly<PensionContributionConfig>,
  _state: ScenarioState,
  _yearContext: YearContext,
  _owner: Owner,
) {
  return {
    amount: config.annualContribution,
    taxTreatment: RELIEF_METHOD_TO_TAX_TREATMENT[config.reliefMethod],
  };
}

export const pensionContributionDefinition: IncomeDrainDefinition<PensionContributionConfig> = {
  type: "pensionContribution",
  displayName: "Pension contribution",
  description: "A contribution into a pension account",
  // A single static value can't represent all three relief methods this
  // type supports — `calculateForYear`'s per-instance return value is
  // the authoritative tax treatment (SPEC.md §9.4); this is the type's
  // most common/default case, for callers that only need a placeholder.
  taxTreatment: "reliefAtSourceBasicRateTopUp",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(pensionContributionDefinition);
