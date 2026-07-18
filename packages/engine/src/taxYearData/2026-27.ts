import type { TaxYearRuleSet } from "./types.js";

/**
 * 2026/27 tax year figures, verified against gov.uk during the writing
 * of SPEC.md (see §0, §6.1) — re-verify against current HMRC guidance
 * before each release; these were captured by an automated fetch of
 * gov.uk pages, not a line-by-line read of primary legislation.
 */
export const ruleSet2026_27: TaxYearRuleSet = {
  taxYear: "2026-27",
  effectiveFrom: "2026-04-06",
  effectiveTo: "2027-04-05",

  incomeTaxEngland: {
    personalAllowance: 12570,
    personalAllowanceTaperThreshold: 100000,
    personalAllowanceTaperRate: 0.5,
    bands: [
      { name: "basic", upTo: 50270, rate: 0.2 },
      { name: "higher", upTo: 125140, rate: 0.4 },
      { name: "additional", upTo: null, rate: 0.45 },
    ],
    marriageAllowance: { transferableAmount: 1260, requiresBasicRateRecipient: true },
  },

  nationalInsurance: {
    primaryThreshold: 12570,
    upperEarningsLimit: 50270,
    mainRate: 0.08,
    upperRate: 0.02,
  },

  dividendTax: {
    allowance: 500,
    basicRate: 0.1075,
    higherRate: 0.3575,
    additionalRate: 0.3935,
  },

  capitalGainsTax: {
    annualExemptAmount: 3000,
    basicRate: 0.18,
    higherRate: 0.24,
  },

  isa: {
    annualSubscriptionLimit: 20000,
    lisaAnnualLimit: 4000,
    lisaBonusRate: 0.25,
  },

  property: {
    incomeAllowance: 1000,
    mortgageInterestReliefRate: 0.2,
    cgtResidentialBasicRate: 0.18,
    cgtResidentialHigherRate: 0.24,
    cgtReportingDeadlineDays: 60,
  },

  pensions: {
    annualAllowance: 60000,
    moneyPurchaseAnnualAllowance: 10000,
    // taperThresholdIncome and taperMinimumAllowance were filled from
    // general knowledge rather than quoted directly from a fetched page
    // during spec-writing (SPEC.md §6.1) — extra scrutiny warranted here.
    taperThresholdIncome: 200000,
    taperThresholdAdjustedIncome: 260000,
    taperMinimumAllowance: 10000,
    lumpSumAllowance: 268275,
    lumpSumAndDeathBenefitAllowance: 1073100,
    // Confirmed current for 2026/27; legislated to rise to 57 from 6 April 2028.
    normalMinimumPensionAge: 55,
  },

  statePension: {
    fullWeeklyAmount: 241.3,
    qualifyingYearsForFull: 35,
    qualifyingYearsMinimum: 10,
  },

  savingsAllowance: {
    basicRatePayer: 1000,
    higherRatePayer: 500,
    additionalRatePayer: 0,
  },

  sources: [
    { description: "Income Tax rates and Personal Allowance", url: "https://www.gov.uk/income-tax-rates" },
    {
      description: "National Insurance rates and thresholds for employers 2026 to 2027",
      url: "https://www.gov.uk/guidance/rates-and-thresholds-for-employers-2026-to-2027",
    },
    { description: "Tax on dividends", url: "https://www.gov.uk/tax-on-dividends" },
    { description: "Capital Gains Tax rates", url: "https://www.gov.uk/capital-gains-tax/rates" },
    {
      description: "Tax-free interest on savings (Personal Savings Allowance)",
      url: "https://www.gov.uk/apply-tax-free-interest-on-savings",
    },
    { description: "Individual Savings Accounts (ISA)", url: "https://www.gov.uk/individual-savings-accounts" },
    { description: "Lifetime ISA", url: "https://www.gov.uk/lifetime-isa" },
    { description: "Pension Annual Allowance", url: "https://www.gov.uk/tax-on-your-private-pension/annual-allowance" },
    {
      description: "Pension Lump Sum Allowance",
      url: "https://www.gov.uk/tax-on-your-private-pension/lump-sum-allowance",
    },
    { description: "New State Pension — what you'll get", url: "https://www.gov.uk/new-state-pension/what-youll-get" },
    { description: "Renting out a property — paying tax", url: "https://www.gov.uk/renting-out-a-property/paying-tax" },
    {
      description: "Tax relief for residential landlords — how it's worked out",
      url: "https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies",
    },
    { description: "Marriage Allowance", url: "https://www.gov.uk/marriage-allowance" },
    {
      description: "Report and pay Capital Gains Tax on UK property",
      url: "https://www.gov.uk/report-and-pay-your-capital-gains-tax/if-you-sold-a-property-in-the-uk-on-or-after-6-april-2020",
    },
  ],
} satisfies TaxYearRuleSet;
