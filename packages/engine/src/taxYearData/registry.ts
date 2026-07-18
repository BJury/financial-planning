import { ruleSet2026_27 } from "./2026-27.js";
import type { TaxYearRuleSet } from "./types.js";

/** Ordered oldest-to-newest. Append, never reorder or remove (SPEC.md §6.2). */
const allRuleSets: readonly TaxYearRuleSet[] = [ruleSet2026_27];

export function getRuleSetForTaxYear(taxYear: string): TaxYearRuleSet {
  const found = allRuleSets.find((r) => r.taxYear === taxYear);
  if (!found) {
    throw new Error(`No TaxYearRuleSet bundled for tax year "${taxYear}"`);
  }
  return found;
}

/**
 * The boundary the engine uses for real-terms projection (SPEC.md §6.2,
 * §5.8): every tax year up to and including this one uses its own
 * published nominal figures; every year beyond it is projected using the
 * Scenario's uprating assumption applied to this rule set's real values.
 */
export function getLatestConfirmedRuleSet(): TaxYearRuleSet {
  const latest = allRuleSets.at(-1);
  if (!latest) {
    throw new Error("No TaxYearRuleSets are bundled — at least one is required.");
  }
  return latest;
}

export function listAllRuleSets(): readonly TaxYearRuleSet[] {
  return allRuleSets;
}
