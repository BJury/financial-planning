/**
 * The shape of one tax year's rule set, as HMRC publishes it — figures
 * are stored in whole pounds (nominal, as published), not Pence, and not
 * deflated to real terms; conversion to Pence and real-terms deflation
 * happens once per Scenario via realTerms/prepareRuleSetForScenario.ts
 * (SPEC.md §8, §5.8). Never mutate or pre-convert these values in place.
 *
 * The Income Tax section is named `incomeTaxEngland` (not bare
 * `incomeTax`) deliberately: v1 is English-rates-only (SPEC.md §1.2), and
 * naming it explicitly now avoids an awkward rename when Scottish bands
 * are picked up from the Roadmap (§14), since that will need its own
 * sibling section here.
 */
export interface TaxBand {
  readonly name: string;
  /** Upper bound of this band in whole pounds, or `null` for the top band. */
  readonly upTo: number | null;
  readonly rate: number;
}

export interface TaxYearRuleSet {
  readonly taxYear: string; // e.g. "2026-27"
  readonly effectiveFrom: string; // ISO date, e.g. "2026-04-06"
  readonly effectiveTo: string; // ISO date, e.g. "2027-04-05"

  readonly incomeTaxEngland: {
    readonly personalAllowance: number;
    readonly personalAllowanceTaperThreshold: number;
    readonly personalAllowanceTaperRate: number;
    readonly bands: readonly TaxBand[];
    readonly marriageAllowance: {
      readonly transferableAmount: number;
      readonly requiresBasicRateRecipient: boolean;
    };
  };

  readonly nationalInsurance: {
    readonly primaryThreshold: number;
    readonly upperEarningsLimit: number;
    readonly mainRate: number;
    readonly upperRate: number;
  };

  readonly dividendTax: {
    readonly allowance: number;
    readonly basicRate: number;
    readonly higherRate: number;
    readonly additionalRate: number;
  };

  readonly capitalGainsTax: {
    readonly annualExemptAmount: number;
    readonly basicRate: number;
    readonly higherRate: number;
  };

  readonly isa: {
    readonly annualSubscriptionLimit: number;
    readonly lisaAnnualLimit: number;
    readonly lisaBonusRate: number;
  };

  readonly property: {
    readonly incomeAllowance: number;
    readonly mortgageInterestReliefRate: number;
    readonly cgtResidentialBasicRate: number;
    readonly cgtResidentialHigherRate: number;
    readonly cgtReportingDeadlineDays: number;
  };

  readonly pensions: {
    readonly annualAllowance: number;
    readonly moneyPurchaseAnnualAllowance: number;
    readonly taperThresholdIncome: number;
    readonly taperThresholdAdjustedIncome: number;
    readonly taperMinimumAllowance: number;
    readonly lumpSumAllowance: number;
    readonly lumpSumAndDeathBenefitAllowance: number;
    readonly normalMinimumPensionAge: number;
  };

  readonly statePension: {
    readonly fullWeeklyAmount: number;
    readonly qualifyingYearsForFull: number;
    readonly qualifyingYearsMinimum: number;
  };

  readonly savingsAllowance: {
    readonly basicRatePayer: number;
    readonly higherRatePayer: number;
    readonly additionalRatePayer: number;
  };

  /** Source references for auditability (SPEC.md §6.2). */
  readonly sources: readonly { readonly description: string; readonly url: string }[];
}
