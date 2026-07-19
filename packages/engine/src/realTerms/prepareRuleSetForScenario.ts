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
  /** The fixed amount transferable under Marriage Allowance (SPEC.md §5.2) — not dynamically 10% of anything at simulation time, just this year's published figure. */
  readonly marriageAllowanceTransferableAmount: Pence;
  /** Standard rate bands only — the Personal Allowance is added separately via `buildFullBandStack`. */
  readonly incomeTaxBands: readonly IncomeTaxBand[];
  readonly nationalInsurance: NationalInsuranceThresholds;
  readonly pensions: {
    readonly annualAllowance: Pence;
    /** The reduced Annual Allowance for money-purchase (DC) pension contributions once a person has flexibly accessed a pension (SPEC.md §5.4) — a flat cap, not itself tapered further by income. */
    readonly moneyPurchaseAnnualAllowance: Pence;
    readonly taperThresholdIncome: Pence;
    readonly taperThresholdAdjustedIncome: Pence;
    readonly taperMinimumAllowance: Pence;
    readonly lumpSumAllowance: Pence;
  };
  readonly savingsAllowance: {
    readonly basicRatePayer: Pence;
    readonly higherRatePayer: Pence;
    readonly additionalRatePayer: Pence;
  };
  readonly dividendTax: {
    readonly allowance: Pence;
    readonly basicRate: number;
    readonly higherRate: number;
    readonly additionalRate: number;
  };
  readonly capitalGainsTax: {
    /** An *annual* allowance (unlike the Lump Sum Allowance) — resets every tax year, no cross-year state to track (SPEC.md §5.5). */
    readonly annualExemptAmount: Pence;
    readonly basicRate: number;
    readonly higherRate: number;
  };
  readonly isa: {
    /** Combined across every ISA type (cash/stocks & shares/LISA) a person holds — the LISA's own smaller sub-limit isn't separately enforced yet. */
    readonly annualSubscriptionLimit: Pence;
  };
  readonly property: {
    /** The flat Property Income Allowance a landlord may deduct instead of actual letting costs, whichever is larger (SPEC.md §5.6). */
    readonly incomeAllowance: Pence;
    readonly mortgageInterestReliefRate: number;
    /**
     * Kept separate from `capitalGainsTax.basicRate`/`higherRate` even
     * though they happen to be equal for 2026/27 — they've historically
     * diverged and could again (SPEC.md §5.6), so this engine never
     * assumes they can be collapsed into one field.
     */
    readonly cgtResidentialBasicRate: number;
    readonly cgtResidentialHigherRate: number;
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
    marriageAllowanceTransferableAmount: uprate(confirmedRuleSet.incomeTaxEngland.marriageAllowance.transferableAmount),
    incomeTaxBands,
    nationalInsurance: {
      primaryThreshold: uprate(confirmedRuleSet.nationalInsurance.primaryThreshold),
      upperEarningsLimit: uprate(confirmedRuleSet.nationalInsurance.upperEarningsLimit),
      mainRate: confirmedRuleSet.nationalInsurance.mainRate,
      upperRate: confirmedRuleSet.nationalInsurance.upperRate,
    },
    pensions: {
      annualAllowance: uprate(confirmedRuleSet.pensions.annualAllowance),
      moneyPurchaseAnnualAllowance: uprate(confirmedRuleSet.pensions.moneyPurchaseAnnualAllowance),
      taperThresholdIncome: uprate(confirmedRuleSet.pensions.taperThresholdIncome),
      taperThresholdAdjustedIncome: uprate(confirmedRuleSet.pensions.taperThresholdAdjustedIncome),
      taperMinimumAllowance: uprate(confirmedRuleSet.pensions.taperMinimumAllowance),
      lumpSumAllowance: uprate(confirmedRuleSet.pensions.lumpSumAllowance),
    },
    savingsAllowance: {
      basicRatePayer: uprate(confirmedRuleSet.savingsAllowance.basicRatePayer),
      higherRatePayer: uprate(confirmedRuleSet.savingsAllowance.higherRatePayer),
      additionalRatePayer: uprate(confirmedRuleSet.savingsAllowance.additionalRatePayer),
    },
    dividendTax: {
      allowance: uprate(confirmedRuleSet.dividendTax.allowance),
      basicRate: confirmedRuleSet.dividendTax.basicRate,
      higherRate: confirmedRuleSet.dividendTax.higherRate,
      additionalRate: confirmedRuleSet.dividendTax.additionalRate,
    },
    capitalGainsTax: {
      annualExemptAmount: uprate(confirmedRuleSet.capitalGainsTax.annualExemptAmount),
      basicRate: confirmedRuleSet.capitalGainsTax.basicRate,
      higherRate: confirmedRuleSet.capitalGainsTax.higherRate,
    },
    isa: {
      annualSubscriptionLimit: uprate(confirmedRuleSet.isa.annualSubscriptionLimit),
    },
    property: {
      incomeAllowance: uprate(confirmedRuleSet.property.incomeAllowance),
      mortgageInterestReliefRate: confirmedRuleSet.property.mortgageInterestReliefRate,
      cgtResidentialBasicRate: confirmedRuleSet.property.cgtResidentialBasicRate,
      cgtResidentialHigherRate: confirmedRuleSet.property.cgtResidentialHigherRate,
    },
  };
}
