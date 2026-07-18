// Public API surface of @fp/engine (SPEC.md §9.1) — the client app imports
// this package directly; there is no separate service boundary to cross.

// Money
export {
  addPence,
  compoundPenceByRate,
  growPenceByRate,
  isNegative,
  maxPence,
  minPence,
  multiplyPenceByRate,
  pence,
  penceToPounds,
  poundsToPence,
  subtractPence,
  sumPence,
  zeroPence,
  type Pence,
} from "./money/pence.js";

// Schema (data model)
export { personId } from "./schema/types.js";
export type {
  Account,
  Household,
  IncomeDrainInstance,
  IncomeSourceInstance,
  IsaAccount,
  Owner,
  PensionAccount,
  Person,
  PersonId,
  Scenario,
} from "./schema/types.js";
export { ageAtYear } from "./schema/age.js";
export { CURRENT_SCHEMA_VERSION, migrateToLatest, SchemaMigrationError } from "./schema/migrations/index.js";

// Real-terms conversion
export { convertNominalToReal } from "./realTerms/convertNominalToReal.js";
export { uprateThreshold, type UpratingPolicy } from "./realTerms/uprateThreshold.js";
export { prepareRuleSetForScenario, type PreparedYearRules } from "./realTerms/prepareRuleSetForScenario.js";

// Tax-year data
export { getLatestConfirmedRuleSet, getRuleSetForTaxYear, listAllRuleSets } from "./taxYearData/registry.js";
export type { TaxBand, TaxYearRuleSet } from "./taxYearData/types.js";

// Catalog (Income Source / Income Drain plugin registry, SPEC.md §3.11/§9.4)
export { registry } from "./catalog/registry.js";
export type {
  CalculationResult,
  CatalogFieldSchema,
  CatalogInputKind,
  DrainResult,
  IncomeDrainDefinition,
  IncomeSourceDefinition,
  ScenarioState,
  TaxCategory,
  TaxTreatment,
  ValidationIssue,
  YearContext,
} from "./catalog/types.js";

// Built-in catalog types — importing them registers each one against the
// shared registry as a side effect (SPEC.md §9.4). The client app should
// import `@fp/engine` (this file) once, early, before calling
// `runProjection` or rendering the catalog picker, so every type is
// registered; their config types are also exported here for pages that
// build a Scenario directly (e.g. Onboarding) rather than only through
// the generic CatalogItemForm.
export type { SalaryConfig } from "./catalog/incomeSources/salary.js";
import "./catalog/incomeSources/salary.js";
export type { PensionContributionConfig, PensionReliefMethod } from "./catalog/incomeDrains/pensionContribution.js";
import "./catalog/incomeDrains/pensionContribution.js";
export type { IsaContributionConfig } from "./catalog/incomeDrains/isaContribution.js";
import "./catalog/incomeDrains/isaContribution.js";

// Simulation
export { runProjection, totalTaxForYear } from "./simulation/runProjection.js";
export type { PersonYearResult, ProjectionResult, YearLedgerRow } from "./simulation/runProjection.js";
