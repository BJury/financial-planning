import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { personId, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection } from "./runProjection.js";
import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";
import "../catalog/incomeSources/oneOffInflow.js";
import "../catalog/incomeSources/rentalIncome.js";
import "../catalog/incomeDrains/pensionContribution.js";
import "../catalog/incomeDrains/isaContribution.js";
import "../catalog/incomeDrains/livingExpenses.js";
import "../catalog/incomeDrains/oneOffOutflow.js";
import "../catalog/incomeDrains/giaContribution.js";
import "../catalog/incomeDrains/cashContribution.js";
import "../catalog/incomeDrains/mortgagePayment.js";

const PERSON_A = personId("a");
const PERSON_B = personId("b");

/**
 * SPEC.md §9.7's worst-case v1 scenario: a two-person household, 50-year
 * horizon, every account type populated, decumulation active with the
 * household drawdown optimiser running. Deliberately dense (multiple
 * drains ending mid-plan, a rental with a mortgage, a joint property, a
 * one-off inflow/outflow, Marriage Allowance elected) rather than
 * minimal, so this genuinely exercises every phase of the year loop, not
 * just the cheapest path through it.
 */
function worstCaseScenario(): Scenario {
  return {
    schemaVersion: 1,
    household: {
      people: [
        { id: PERSON_A, dateOfBirth: "1970-01-01", targetRetirementAge: 60, projectionEndAge: 95 },
        { id: PERSON_B, dateOfBirth: "1972-01-01", targetRetirementAge: 60, projectionEndAge: 95 },
      ],
      relationshipStatus: "marriedOrCivilPartnership",
      targetIncomeMode: "combined",
      marriageAllowanceElection: PERSON_A,
    },
    accounts: [
      {
        kind: "pension",
        id: "pA",
        owner: PERSON_A,
        pensionType: "sipp",
        currentBalance: poundsToPence(400000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: poundsToPence(3000),
      },
      {
        kind: "pension",
        id: "pB",
        owner: PERSON_B,
        pensionType: "workplaceDC",
        currentBalance: poundsToPence(350000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: poundsToPence(3000),
      },
      { kind: "isa", id: "iA", owner: PERSON_A, isaType: "stocksAndShares", currentBalance: poundsToPence(80000), annualGrowthRate: 0.04 },
      { kind: "isa", id: "iB", owner: PERSON_B, isaType: "stocksAndShares", currentBalance: poundsToPence(60000), annualGrowthRate: 0.04 },
      { kind: "gia", id: "g1", owner: "joint", currentBalance: poundsToPence(100000), costBasis: poundsToPence(70000), annualGrowthRate: 0.03, annualDividendYield: 0.03 },
      { kind: "cash", id: "c1", owner: "joint", currentBalance: poundsToPence(30000), annualGrowthRate: 0.03 },
      {
        kind: "property",
        id: "prop1",
        owner: "joint",
        propertyType: "mainResidence",
        currentBalance: poundsToPence(500000),
        annualGrowthRate: 0.02,
        purchasePrice: poundsToPence(300000),
        purchaseDate: "2005-01-01",
        mortgage: { initialBalance: poundsToPence(150000), nominalInterestRate: 0.045, repaymentType: "repayment", termYears: 15, annualPayment: poundsToPence(14000) },
      },
      {
        kind: "property",
        id: "prop2",
        owner: PERSON_A,
        propertyType: "rental",
        currentBalance: poundsToPence(220000),
        annualGrowthRate: 0.02,
        purchasePrice: poundsToPence(150000),
        purchaseDate: "2012-01-01",
        rentalDetails: { grossAnnualRentalIncome: poundsToPence(14000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0.02 },
        mortgage: { initialBalance: poundsToPence(80000), nominalInterestRate: 0.045, repaymentType: "interestOnly", termYears: 20, annualPayment: poundsToPence(3600) },
      },
    ],
    incomeSources: [
      { id: "s1", type: "salary", owner: PERSON_A, config: { grossAnnualSalary: poundsToPence(60000), annualGrowthRate: 0.02, endAge: 60 } },
      { id: "s2", type: "salary", owner: PERSON_B, config: { grossAnnualSalary: poundsToPence(55000), annualGrowthRate: 0.02, endAge: 60 } },
      { id: "s3", type: "rentalIncome", owner: PERSON_A, config: { propertyId: "prop2" } },
      { id: "s4", type: "oneOffInflow", owner: "joint", config: { amount: poundsToPence(50000), date: "2040-06-01", category: "inheritance" } },
      { id: "s5", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 60, householdSplitStrategy: "optimised" } },
    ],
    incomeDrains: [
      { id: "d1", type: "pensionContribution", owner: PERSON_A, config: { pensionAccountId: "pA", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(8000) }, endDate: "2030-01-01" },
      { id: "d2", type: "pensionContribution", owner: PERSON_B, config: { pensionAccountId: "pB", reliefMethod: "salarySacrifice", annualContribution: poundsToPence(6000) }, endDate: "2030-01-01" },
      { id: "d3", type: "isaContribution", owner: PERSON_A, config: { isaAccountId: "iA", annualContribution: poundsToPence(15000) }, endDate: "2030-01-01" },
      { id: "d4", type: "isaContribution", owner: PERSON_B, config: { isaAccountId: "iB", annualContribution: poundsToPence(10000) }, endDate: "2030-01-01" },
      { id: "d5", type: "giaContribution", owner: "joint", config: { giaAccountId: "g1", annualContribution: poundsToPence(5000) }, endDate: "2030-01-01" },
      { id: "d6", type: "cashContribution", owner: "joint", config: { cashAccountId: "c1", annualContribution: poundsToPence(2000) }, endDate: "2030-01-01" },
      { id: "d7", type: "mortgagePayment", owner: "joint", config: { propertyId: "prop1" } },
      { id: "d8", type: "mortgagePayment", owner: PERSON_A, config: { propertyId: "prop2" } },
      { id: "d9", type: "livingExpenses", owner: "joint", config: { annualAmount: poundsToPence(30000) } },
      { id: "d10", type: "oneOffOutflow", owner: "joint", config: { amount: poundsToPence(10000), date: "2035-06-01", category: "other" } },
    ],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("performance (SPEC.md §9.7)", () => {
  it("completes a full recompute of the worst-case 50-year scenario in well under the 100ms target", () => {
    const scenario = worstCaseScenario();
    runProjection(scenario, ruleSet2026_27, 50); // warm up the JIT before timing

    const runs = 10;
    const timings: number[] = [];
    for (let i = 0; i < runs; i++) {
      const start = Date.now();
      runProjection(scenario, ruleSet2026_27, 50);
      timings.push(Date.now() - start);
    }
    timings.sort((a, b) => a - b);
    const median = timings[Math.floor(runs / 2)] ?? Number.POSITIVE_INFINITY;

    // Generous relative to the observed ~3ms median (SPEC.md's own naive-
    // full-recompute prediction) — this is a regression guard against a
    // real slowdown, not a tight bound tuned to today's exact number.
    expect(median).toBeLessThan(100);
  });
});
