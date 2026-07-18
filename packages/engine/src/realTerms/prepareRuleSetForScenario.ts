import { poundsToPence, type Pence } from "../money/pence.js";
import type { NationalInsuranceThresholds } from "../tax/nationalInsurance.js";
import type { IncomeTaxBand } from "../tax/incomeTax.js";
import type { TaxYearRuleSet } from "../taxYearData/types.js";
import { uprateThreshold, type UpratingPolicy } from "./uprateThreshold.js";

/**
 * A tax year's rules, converted to Pence and projected to real terms for
 * one specific simulated year (SPEC.md §5.8, §8) — `TaxYearRuleSet`
 * itself is never mutated or pre-converted; this is computed once per
 * simulated year from the latest confirmed rule set.
 */
export interface PreparedYearRules {
  readonly personalAllowance: Pence;
  readonly personalAllowanceTaperThreshold: Pence;
  readonly personalAllowanceTaperRate: number;
  /** Standard rate bands only — the Personal Allowance is added separately via `buildFullBandStack`. */
  readonly incomeTaxBands: readonly IncomeTaxBand[];
  readonly nationalInsurance: NationalInsuranceThresholds;
  readonly pensions: {
    readonly annualAllowance: Pence;
    readonly taperThresholdIncome: Pence;
    readonly taperThresholdAdjustedIncome: Pence;
    readonly taperMinimumAllowance: Pence;
    readonly lumpSumAllowance: Pence;
  };
}

/**
 * @param confirmedRuleSet the latest confirmed TaxYearRuleSet (nominal, pounds)
 * @param yearsElapsed years beyond `confirmedRuleSet`'s own tax year — 0 means
 *   this *is* the confirmed rule set's own year, using its published figures directly.
 */
export function prepareRuleSetForScenario(
  confirmedRuleSet: TaxYearRuleSet,
  upratingPolicy: UpratingPolicy,
  inflationRate: number,
  yearsElapsed: number,
): PreparedYearRules {
  const uprate = (poundsValue: number): Pence =>
    uprateThreshold(poundsToPence(poundsValue), upratingPolicy, inflationRate, yearsElapsed);

  const incomeTaxBands: readonly IncomeTaxBand[] = confirmedRuleSet.incomeTaxEngland.bands.map((band) => ({
    name: band.name,
    upTo: band.upTo === null ? null : uprate(band.upTo),
    rate: band.rate,
  }));

  return {
    personalAllowance: uprate(confirmedRuleSet.incomeTaxEngland.personalAllowance),
    personalAllowanceTaperThreshold: uprate(confirmedRuleSet.incomeTaxEngland.personalAllowanceTaperThreshold),
    personalAllowanceTaperRate: confirmedRuleSet.incomeTaxEngland.personalAllowanceTaperRate,
    incomeTaxBands,
    nationalInsurance: {
      primaryThreshold: uprate(confirmedRuleSet.nationalInsurance.primaryThreshold),
      upperEarningsLimit: uprate(confirmedRuleSet.nationalInsurance.upperEarningsLimit),
      mainRate: confirmedRuleSet.nationalInsurance.mainRate,
      upperRate: confirmedRuleSet.nationalInsurance.upperRate,
    },
    pensions: {
      annualAllowance: uprate(confirmedRuleSet.pensions.annualAllowance),
      taperThresholdIncome: uprate(confirmedRuleSet.pensions.taperThresholdIncome),
      taperThresholdAdjustedIncome: uprate(confirmedRuleSet.pensions.taperThresholdAdjustedIncome),
      taperMinimumAllowance: uprate(confirmedRuleSet.pensions.taperMinimumAllowance),
      lumpSumAllowance: uprate(confirmedRuleSet.pensions.lumpSumAllowance),
    },
  };
}
