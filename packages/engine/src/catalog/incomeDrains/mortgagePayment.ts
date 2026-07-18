import { zeroPence } from "../../money/pence.js";
import { deflateNominalAmount } from "../../realTerms/deflateNominalAmount.js";
import type { Owner, Property } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeDrainDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export interface MortgagePaymentConfig {
  /** Which mortgaged `Property.id` this payment is for. */
  readonly propertyId: string;
}

const fields: readonly CatalogFieldSchema<MortgagePaymentConfig>[] = [
  { key: "propertyId", label: "Property", input: "select", required: true },
];

function findProperty(state: ScenarioState, propertyId: string): Property | undefined {
  return state.scenario.accounts.find((a): a is Property => a.kind === "property" && a.id === propertyId);
}

function validate(config: Readonly<MortgagePaymentConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.propertyId) {
    issues.push({ field: "propertyId", tier: "hardBlock", message: "A property must be selected." });
  }

  return issues;
}

function isActive(config: Readonly<MortgagePaymentConfig>, state: ScenarioState, yearContext: YearContext, _owner: Owner): boolean {
  const property = findProperty(state, config.propertyId);
  if (!property?.mortgage) {
    return false;
  }
  if (yearContext.yearIndex >= property.mortgage.termYears) {
    return false;
  }
  if (property.plannedSale && yearContext.calendarYear >= new Date(property.plannedSale.saleDate).getUTCFullYear()) {
    return false;
  }
  return true;
}

/**
 * The mortgage's payment is fixed in nominal terms for its whole term
 * (a real fixed-rate mortgage's actual monthly payment doesn't change,
 * SPEC.md §5.8) — so unlike every other Income Drain, this figure
 * *declines* in real terms year over year rather than staying flat or
 * growing, which `deflateNominalAmount` applies directly from the
 * embedded `Mortgage.annualPayment` and this year's elapsed time. No
 * running-balance state is needed for the payment amount itself (only
 * the interest/capital split does, computed separately in
 * `simulation/runProjection.ts` via `mortgage/amortizeMortgageYear.ts`).
 */
function calculateForYear(config: Readonly<MortgagePaymentConfig>, state: ScenarioState, yearContext: YearContext, _owner: Owner) {
  const property = findProperty(state, config.propertyId);
  const mortgage = property?.mortgage;
  if (!mortgage) {
    return { amount: zeroPence(), taxTreatment: "none" as const };
  }
  return {
    amount: deflateNominalAmount(mortgage.annualPayment, state.scenario.inflationRate, yearContext.yearIndex),
    taxTreatment: "none" as const,
  };
}

export const mortgagePaymentDefinition: IncomeDrainDefinition<MortgagePaymentConfig> = {
  type: "mortgagePayment",
  displayName: "Mortgage payment",
  description: "The mortgage payment for a property, not itself deductible",
  taxTreatment: "none",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeDrain(mortgagePaymentDefinition);
