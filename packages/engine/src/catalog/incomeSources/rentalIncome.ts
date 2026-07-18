import { maxPence, subtractPence, zeroPence } from "../../money/pence.js";
import type { Owner, Property } from "../../schema/types.js";
import { registry } from "../registry.js";
import type {
  CatalogFieldSchema,
  IncomeSourceDefinition,
  ScenarioState,
  ValidationIssue,
  YearContext,
} from "../types.js";

export interface RentalIncomeConfig {
  /** Which rental `Property.id` this income comes from. */
  readonly propertyId: string;
}

const fields: readonly CatalogFieldSchema<RentalIncomeConfig>[] = [
  { key: "propertyId", label: "Rental property", input: "select", required: true },
];

function findProperty(state: ScenarioState, propertyId: string): Property | undefined {
  return state.scenario.accounts.find((a): a is Property => a.kind === "property" && a.id === propertyId);
}

function validate(config: Readonly<RentalIncomeConfig>): readonly ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!config.propertyId) {
    issues.push({ field: "propertyId", tier: "hardBlock", message: "A rental property must be selected." });
  }

  return issues;
}

function isActive(config: Readonly<RentalIncomeConfig>, state: ScenarioState, yearContext: YearContext, _owner: Owner): boolean {
  const property = findProperty(state, config.propertyId);
  if (!property || property.propertyType !== "rental") {
    return false;
  }
  // Rental income stops once the property has been sold (SPEC.md §3.8) —
  // the sale itself is handled by a dedicated `runProjection` pass, not
  // this generic catalog type, since it needs CGT/PRR/mortgage-redemption
  // logic no catalog type's signature exposes.
  if (property.plannedSale && yearContext.calendarYear >= new Date(property.plannedSale.saleDate).getUTCFullYear()) {
    return false;
  }
  return true;
}

/**
 * A standalone, best-effort approximation only (deducts actual letting
 * costs, ignoring the Property Income Allowance comparison) — see
 * `simulation/runProjection.ts`, which is where this type's rental
 * profit is *actually* computed, since the allowance-vs-actual-expenses
 * comparison needs this tax year's `property.incomeAllowance`, and the
 * mortgage interest credit needs the property's running mortgage
 * balance — neither is available from this function's signature
 * (catalog types deliberately never see tax-year data, SPEC.md
 * §9.1/§9.4), the same reason `targetDrawdownIncome.ts` special-cases
 * itself. This function exists so the type is still registry-complete
 * and its fields/validate/isActive wiring is independently testable.
 */
function calculateForYear(config: Readonly<RentalIncomeConfig>, state: ScenarioState, _yearContext: YearContext, _owner: Owner) {
  const property = findProperty(state, config.propertyId);
  const rentalDetails = property?.rentalDetails;
  if (!rentalDetails) {
    return { kind: "simple" as const, amount: zeroPence(), taxCategory: "rentalProfit" as const };
  }
  return {
    kind: "simple" as const,
    amount: maxPence(subtractPence(rentalDetails.grossAnnualRentalIncome, rentalDetails.lettingCosts), zeroPence()),
    taxCategory: "rentalProfit" as const,
  };
}

export const rentalIncomeDefinition: IncomeSourceDefinition<RentalIncomeConfig> = {
  type: "rentalIncome",
  displayName: "Rental income",
  description: "Net rental profit from a buy-to-let property, taxed at your marginal rate",
  taxCategory: "rentalProfit",
  fields,
  validate,
  isActive,
  calculateForYear,
};

registry.registerIncomeSource(rentalIncomeDefinition);
