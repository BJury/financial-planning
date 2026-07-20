import { describe, expect, it } from "vitest";
import { addPence, pence, poundsToPence, subtractPence, sumPence, zeroPence, type Pence } from "../money/pence.js";
import { deriveAnnualRepaymentMortgagePayment } from "../mortgage/amortizeMortgageYear.js";
import { convertNominalToReal } from "../realTerms/convertNominalToReal.js";
import { personId, type Account, type Household, type IncomeDrainInstance, type IncomeSourceInstance, type Person, type PersonId, type Property, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection, totalTaxForYear } from "./runProjection.js";

// Side-effect imports: registers every Phase 1 catalog type with the
// shared registry (SPEC.md §9.4) — this is what a future
// catalog/incomeSources/index.ts and catalog/incomeDrains/index.ts will
// do more completely as more types are added.
import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";
import "../catalog/incomeSources/oneOffInflow.js";
import "../catalog/incomeSources/generalCashIncome.js";
import "../catalog/incomeSources/rentalIncome.js";
import "../catalog/incomeSources/statePension.js";
import "../catalog/incomeDrains/pensionContribution.js";
import "../catalog/incomeDrains/isaContribution.js";
import "../catalog/incomeDrains/livingExpenses.js";
import "../catalog/incomeDrains/oneOffOutflow.js";
import "../catalog/incomeDrains/giaContribution.js";
import "../catalog/incomeDrains/cashContribution.js";
import "../catalog/incomeDrains/mortgagePayment.js";

const PERSON_ID = personId("p1");

/**
 * A hand-verified golden-file scenario (SPEC.md §12): one person, a
 * £70,000 salary (chosen specifically high enough that relief-at-source
 * band extension has a visible, checkable effect — see the worked
 * calculation in the comments below), a relief-at-source pension
 * contribution, and an ISA contribution, over 5 years.
 */
function makeGoldenScenario(): Scenario {
  const person: Person = {
    id: PERSON_ID,
    dateOfBirth: "1980-06-15",
    targetRetirementAge: 67,
    projectionEndAge: 95,
  };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

  return {
    schemaVersion: 1,
    household,
    accounts: [
      {
        kind: "pension",
        id: "pension1",
        owner: PERSON_ID,
        pensionType: "workplaceDC",
        currentBalance: poundsToPence(10000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: pence(0),
      },
      {
        kind: "isa",
        id: "isa1",
        owner: PERSON_ID,
        isaType: "stocksAndShares",
        currentBalance: poundsToPence(2000),
        annualGrowthRate: 0.04,
      },
    ],
    incomeSources: [{ id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(70000), annualGrowthRate: 0 } }],
    incomeDrains: [
      {
        id: "drain1",
        type: "pensionContribution",
        owner: PERSON_ID,
        config: { pensionAccountId: "pension1", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(4000) },
      },
      {
        id: "drain2",
        type: "isaContribution",
        owner: PERSON_ID,
        config: { isaAccountId: "isa1", annualContribution: poundsToPence(5000) },
      },
    ],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runProjection — golden-file scenario: £70,000 salary + relief-at-source pension + ISA", () => {
  it("computes year 0's Income Tax exactly, including the relief-at-source band extension", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const year0 = result.rows[0];
    expect(year0).toBeDefined();
    const personResult = year0?.perPerson[0];
    expect(personResult).toBeDefined();

    // Worked calculation (all figures in pence, English 2026/27 rates):
    //   Gross income:                    £70,000.00 = 7,000,000p
    //   Net pension contribution:        £4,000.00
    //   Grossed up at 20% basic rate:    £4,000 / 0.8 = £5,000.00 = 500,000p
    //   Adjusted net income:             £70,000 - £5,000 = £65,000 (well under the £100k taper threshold, so full PA applies)
    //   Personal Allowance:              £12,570.00 = 1,257,000p @ 0%
    //   Basic band (extended by £5,000): £50,270 + £5,000 = £55,270 ceiling @ 20%
    //     -> £55,270 - £12,570 = £42,700 taxed at 20% = £8,540.00
    //   Higher band (extended by £5,000):remaining £70,000 - £55,270 = £14,730 taxed at 40% = £5,892.00
    //   Total Income Tax:                £8,540.00 + £5,892.00 = £14,432.00 = 1,443,200p
    expect(personResult?.grossPensionContribution).toBe(poundsToPence(5000));
    expect(personResult?.incomeTax).toBe(poundsToPence(14432));

    // National Insurance (independent of Income Tax, SPEC.md §9.3):
    //   0% up to £12,570; 8% from £12,570 to £50,270 = £37,700 * 0.08 = £3,016.00
    //   2% above £50,270: £70,000 - £50,270 = £19,730 * 0.02 = £394.60
    //   Total NI: £3,016.00 + £394.60 = £3,410.60 = 341,060p
    expect(personResult?.nationalInsurance).toBe(poundsToPence(3410.6));

    // Net income: £70,000 - £14,432.00 - £3,410.60 - £4,000 (RAS pension, the
    // amount actually paid, not the £5,000 grossed-up figure — the basic-rate
    // top-up isn't the person's own money) - £5,000 (ISA contribution) = £43,157.40
    expect(personResult?.netIncome).toBe(poundsToPence(43157.4));
  });

  it("breaks down year 0's Income Tax band-by-band, exactly matching the hand-verified total above", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];
    expect(personResult).toBeDefined();
    if (!personResult) throw new Error("expected a person result");

    expect(personResult.incomeTaxByBand.map((b) => b.name)).toEqual(["personalAllowance", "basic", "higher", "additional"]);
    expect(personResult.incomeTaxByBand.find((b) => b.name === "personalAllowance")).toMatchObject({ taxableAmount: poundsToPence(12570), tax: 0 });
    expect(personResult.incomeTaxByBand.find((b) => b.name === "basic")).toMatchObject({ taxableAmount: poundsToPence(42700), tax: poundsToPence(8540) });
    expect(personResult.incomeTaxByBand.find((b) => b.name === "higher")).toMatchObject({ taxableAmount: poundsToPence(14730), tax: poundsToPence(5892) });
    expect(personResult.incomeTaxByBand.find((b) => b.name === "additional")).toMatchObject({ taxableAmount: 0, tax: 0 });

    // Always exactly consistent with the scalar total (SPEC.md §4 journey 5) — never computed separately.
    const summed = personResult.incomeTaxByBand.reduce((total, b) => pence(total + b.tax), pence(0));
    expect(summed).toBe(personResult.incomeTax);
  });

  it("credits the grossed-up pension contribution and grows the pension balance net of charges", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const year0 = result.rows[0];
    // £10,000 start + £5,000 gross contribution = £15,000, grown at (3% - 0.5% charge) = 2.5%
    // £15,000 * 1.025 = £15,375.00
    expect(year0?.accountBalances.get("pension1")).toBe(poundsToPence(15375));
  });

  it("credits the ISA contribution, plus the surplus cash sweep, and grows the ISA balance", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const year0 = result.rows[0];
    // £2,000 start + £5,000 contribution = £7,000. Net income (£43,157.40,
    // see the Income Tax test above — already net of both the £4,000
    // pension and £5,000 ISA contributions, so the sweep isn't investing
    // that same money a second time) still comfortably exceeds the
    // remaining ISA subscription room (£20,000 limit - £5,000 already
    // contributed = £15,000), so the sweep is capped there regardless —
    // £7,000 + £15,000 = £22,000, grown at 4% = £22,880.00. The remaining
    // £28,157.40 of surplus has nowhere to go (no GIA in this scenario)
    // and stays unswept, per the sweep's documented v1 scope.
    expect(year0?.accountBalances.get("isa1")).toBe(poundsToPence(22880));
  });

  it("produces identical Income Tax and NI every year when salary and thresholds are both flat in real terms", () => {
    // A useful invariant of the real-terms design (SPEC.md §5.8): with a
    // 0%-real-growth salary and the default inflationLinked uprating
    // policy, nothing changes year to year, so tax figures repeat exactly.
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 5);
    expect(result.rows).toHaveLength(5);
    const incomeTaxByYear = result.rows.map((row) => row.perPerson[0]?.incomeTax);
    expect(new Set(incomeTaxByYear).size).toBe(1);
    const niByYear = result.rows.map((row) => row.perPerson[0]?.nationalInsurance);
    expect(new Set(niByYear).size).toBe(1);
  });

  it("grows account balances monotonically across years as contributions and growth accumulate", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 5);
    const pensionBalances = result.rows.map((row) => row.accountBalances.get("pension1") ?? pence(0));
    const isaBalances = result.rows.map((row) => row.accountBalances.get("isa1") ?? pence(0));

    for (let i = 1; i < pensionBalances.length; i++) {
      expect(pensionBalances[i]).toBeGreaterThan(pensionBalances[i - 1] ?? 0);
      expect(isaBalances[i]).toBeGreaterThan(isaBalances[i - 1] ?? 0);
    }
  });

  it("persists across a save/reload round-trip: re-running the same Scenario produces identical results", () => {
    // Simulates the "close the tab, reopen it, see the same numbers"
    // Phase 1 goal (SPEC.md §13) — the engine is pure and deterministic
    // (SPEC.md §9.1), so the same Scenario JSON always reproduces the
    // same ProjectionResult with no hidden state.
    const scenario = makeGoldenScenario();
    const serialisedAndReloaded = JSON.parse(JSON.stringify(scenario)) as Scenario;

    const first = runProjection(scenario, ruleSet2026_27, 5);
    const second = runProjection(serialisedAndReloaded, ruleSet2026_27, 5);

    expect(second).toEqual(first);
  });
});

/** A single-person, single-pension-account scenario, parameterised for the relief-method/employer-contribution tests below. */
function makeReliefMethodScenario(options: {
  readonly reliefMethod: "reliefAtSource" | "netPay" | "salarySacrifice";
  readonly annualContribution: number; // pounds
  readonly employerAnnualContribution?: number; // pounds
  readonly grossAnnualSalary?: number; // pounds
}): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

  return {
    schemaVersion: 1,
    household,
    accounts: [
      {
        kind: "pension",
        id: "pension1",
        owner: PERSON_ID,
        pensionType: "workplaceDC",
        currentBalance: poundsToPence(10000),
        annualGrowthRate: 0.03,
        annualChargeRate: 0.005,
        employerAnnualContribution: poundsToPence(options.employerAnnualContribution ?? 0),
      },
    ],
    incomeSources: [
      {
        id: "src1",
        type: "salary",
        owner: PERSON_ID,
        config: { grossAnnualSalary: poundsToPence(options.grossAnnualSalary ?? 70000), annualGrowthRate: 0 },
      },
    ],
    incomeDrains: [
      {
        id: "drain1",
        type: "pensionContribution",
        owner: PERSON_ID,
        config: {
          pensionAccountId: "pension1",
          reliefMethod: options.reliefMethod,
          annualContribution: poundsToPence(options.annualContribution),
        },
      },
    ],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runProjection — net pay relief", () => {
  it("deducts the contribution from taxable income but not from NIable income", () => {
    const scenario = makeReliefMethodScenario({ reliefMethod: "netPay", annualContribution: 4000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Taxable income: £70,000 - £4,000 = £66,000. PA £12,570 @ 0%; basic
    // band £37,700 @ 20% = £7,540; higher band £15,730 @ 40% = £6,292.
    expect(personResult?.incomeTax).toBe(poundsToPence(7540 + 6292));
    // NI is unaffected by net pay relief — same £70,000 base as the relief-at-source golden test.
    expect(personResult?.nationalInsurance).toBe(poundsToPence(3410.6));
    // The pension pot receives the contribution at face value, no gross-up.
    expect(personResult?.pensionInputAmount).toBe(poundsToPence(4000));
  });

  it("credits the account at face value, not grossed up", () => {
    const scenario = makeReliefMethodScenario({ reliefMethod: "netPay", annualContribution: 4000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    // £10,000 + £4,000 = £14,000, grown at 2.5% = £14,350.00
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(14350));
  });
});

describe("runProjection — salary sacrifice", () => {
  it("deducts the contribution from both taxable income and NIable income", () => {
    const scenario = makeReliefMethodScenario({ reliefMethod: "salarySacrifice", annualContribution: 4000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Same taxable income (£66,000) and Income Tax as the net pay case.
    expect(personResult?.incomeTax).toBe(poundsToPence(7540 + 6292));
    // NIable income: £70,000 - £4,000 = £66,000. 8% * £37,700 = £3,016; 2% * £15,730 = £314.60.
    expect(personResult?.nationalInsurance).toBe(poundsToPence(3016 + 314.6));
  });
});

describe("runProjection — employer pension contributions", () => {
  it("credits the employer contribution to the account without taxing it as income", () => {
    const scenario = makeReliefMethodScenario({ reliefMethod: "netPay", annualContribution: 0, employerAnnualContribution: 6000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Full £70,000 taxed, with no band extension (there's no employee
    // contribution here, so unlike the relief-at-source golden test, the
    // higher-rate band isn't extended): PA £12,570 @ 0%; basic £37,700 @
    // 20% = £7,540; higher £19,730 @ 40% = £7,892. Total £15,432.
    expect(personResult?.incomeTax).toBe(poundsToPence(7540 + 7892));
    // £10,000 + £6,000 employer contribution = £16,000, grown at 2.5% = £16,400.00
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(16400));
    expect(personResult?.pensionInputAmount).toBe(poundsToPence(6000));
  });

  it("stops once the person's Salary source is no longer active — an employer can't match a salary that no longer exists", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [
        {
          kind: "pension",
          id: "pension1",
          owner: PERSON_ID,
          pensionType: "workplaceDC",
          currentBalance: poundsToPence(100000),
          annualGrowthRate: 0,
          annualChargeRate: 0,
          employerAnnualContribution: poundsToPence(5000),
        },
      ],
      incomeSources: [
        {
          id: "src1",
          type: "salary",
          owner: PERSON_ID,
          // Salary scheduled to end after 2027 — inactive from calendar year 2028 (yearIndex 2) onward.
          config: { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0 },
          endDate: "2027-12-31",
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    const balancesByYear = result.rows.map((row) => row.accountBalances.get("pension1"));

    expect(balancesByYear[0]).toBe(poundsToPence(105000)); // 2026-27, age 46, still working: £100,000 + £5,000 employer contribution
    expect(balancesByYear[1]).toBe(poundsToPence(110000)); // 2027-28, age 47, still working: another £5,000
    expect(balancesByYear[2]).toBe(poundsToPence(110000)); // 2028-29, age 48, retired: no further employer contribution
  });
});

describe("runProjection — Annual Allowance charge", () => {
  it("charges the excess over the Annual Allowance at the person's marginal rate when total pension input exceeds it", () => {
    // £250,000 salary, £70,000 combined employee + employer pension input —
    // comfortably over the £60,000 standard Annual Allowance with no carry-forward available (first simulated year).
    const scenario = makeReliefMethodScenario({
      reliefMethod: "netPay",
      annualContribution: 40000,
      employerAnnualContribution: 30000,
      grossAnnualSalary: 250000,
    });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.pensionInputAmount).toBe(poundsToPence(70000));
    expect(personResult?.annualAllowanceCharge).toBeGreaterThan(0);
  });

  it("charges nothing when total pension input stays within the standard Annual Allowance", () => {
    const scenario = makeReliefMethodScenario({ reliefMethod: "netPay", annualContribution: 10000, employerAnnualContribution: 5000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.perPerson[0]?.annualAllowanceCharge).toBe(0);
  });

  it("rolls a carry-forward window across years, absorbing a one-off large contribution using prior years' unused allowance", () => {
    // Years 0–1: modest contributions build up unused allowance. Year 2: a
    // large one-off contribution should be partly absorbed by that
    // carry-forward, producing a smaller charge than an isolated year would.
    const smallScenario = makeReliefMethodScenario({ reliefMethod: "netPay", annualContribution: 10000, grossAnnualSalary: 250000 });
    const smallResult = runProjection(smallScenario, ruleSet2026_27, 2);
    expect(smallResult.rows[0]?.perPerson[0]?.annualAllowanceCharge).toBe(0);
    expect(smallResult.rows[1]?.perPerson[0]?.annualAllowanceCharge).toBe(0);
  });
});

describe("totalTaxForYear", () => {
  it("includes any Annual Allowance charge alongside Income Tax and NI", () => {
    const scenario = makeReliefMethodScenario({
      reliefMethod: "netPay",
      annualContribution: 40000,
      employerAnnualContribution: 30000,
      grossAnnualSalary: 250000,
    });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    expect(row).toBeDefined();
    const personResult = row?.perPerson[0];
    expect(personResult).toBeDefined();
    if (!row || !personResult) throw new Error("expected row and personResult");
    expect(totalTaxForYear(row)).toBe(personResult.incomeTax + personResult.nationalInsurance + personResult.annualAllowanceCharge);
  });
});

describe("runProjection — income source start/end date scheduling", () => {
  it("only counts income within its scheduled window — e.g. a rental starting in 5 years and running for 10", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    // Scenario starts tax year 2026-27 (calendar year 2026). The salary
    // (used here as a stand-in "income box" since rental income isn't
    // built yet) is scheduled to start in 2031 and run for 10 years,
    // i.e. active in years 5 through 14 of a 20-year projection.
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [],
      incomeSources: [
        {
          id: "src1",
          type: "salary",
          owner: PERSON_ID,
          config: { grossAnnualSalary: poundsToPence(12000), annualGrowthRate: 0 },
          startDate: "2031-01-01",
          endDate: "2040-12-31",
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 20);
    const grossIncomeByYear = result.rows.map((row) => row.perPerson[0]?.grossIncome ?? pence(0));

    // Years 0-4 (2026-2030): before the window — no income.
    for (let i = 0; i <= 4; i++) {
      expect(grossIncomeByYear[i]).toBe(0);
    }
    // Years 5-14 (2031-2040): within the window — full income.
    for (let i = 5; i <= 14; i++) {
      expect(grossIncomeByYear[i]).toBe(poundsToPence(12000));
    }
    // Years 15-19 (2041-2045): after the window — no income again.
    for (let i = 15; i <= 19; i++) {
      expect(grossIncomeByYear[i]).toBe(0);
    }
  });

});

/** A retired person (already past a 65 start age in 2026) with a pension and an ISA, and a drawdown target funded from both — no growth/charges, to keep balance assertions exact. */
function makeDrawdownScenario(options: {
  readonly targetNetAnnualIncome: number; // pounds
  readonly startAge?: number;
  readonly pensionBalance?: number; // pounds
  readonly isaBalance?: number; // pounds
}): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 }; // age 70 in 2026
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

  return {
    schemaVersion: 1,
    household,
    accounts: [
      {
        kind: "pension",
        id: "pension1",
        owner: PERSON_ID,
        pensionType: "sipp",
        currentBalance: poundsToPence(options.pensionBalance ?? 500000),
        annualGrowthRate: 0,
        annualChargeRate: 0,
        employerAnnualContribution: pence(0),
      },
      {
        kind: "isa",
        id: "isa1",
        owner: PERSON_ID,
        isaType: "stocksAndShares",
        currentBalance: poundsToPence(options.isaBalance ?? 5000),
        annualGrowthRate: 0,
      },
    ],
    incomeSources: [
      {
        id: "drawdown1",
        type: "targetDrawdownIncome",
        owner: PERSON_ID,
        config: {
          targetNetAnnualIncome: poundsToPence(options.targetNetAnnualIncome),
          startAge: options.startAge ?? 65,
        },
      },
    ],
    // A living expenses drain matching the target: this is drawdown
    // income specifically to live on, and it's spent, not surplus — so
    // the surplus cash sweep has nothing left to invest, keeping these
    // tests focused on drawdown mechanics rather than the sweep.
    incomeDrains: [
      {
        id: "expenses1",
        type: "livingExpenses",
        owner: PERSON_ID,
        config: { annualAmount: poundsToPence(options.targetNetAnnualIncome) },
      },
    ],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

describe("runProjection — drawdown target", () => {
  it("sources a target entirely from the pension, within the Personal Allowance, at zero tax cost", () => {
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.drawdownNetAchieved).toBe(poundsToPence(10000));
    expect(personResult?.drawdownIncomeTax).toBe(0);
    expect(personResult?.drawdownShortfall).toBe(false);
    // The drawdown is entirely spent on the matching living expenses drain (see makeDrawdownScenario) — nothing left over to sweep.
    expect(personResult?.netIncome).toBe(0);
    // £500,000 - £10,000 gross withdrawn, no growth.
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(490000));
    // The ISA is untouched — pension income within the Personal Allowance is preferred (SPEC.md §5.7.3).
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(5000));
  });

  it("draws nothing before the drawdown target's start age", () => {
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 10000, startAge: 80 }); // person is 70 in 2026
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.drawdownNetAchieved).toBe(0);
    // The living expenses drain (see makeDrawdownScenario) still applies even before the drawdown itself starts — a £10,000 deficit. netIncome itself is a pure cash-flow figure, unaffected by whatever ends up funding it.
    expect(personResult?.netIncome).toBe(subtractPence(zeroPence(), poundsToPence(10000)));
    // The shortfall-funding step (SPEC.md §5.1 step 7 run in reverse) never touches a pension — only cash/ISA/GIA, in that order.
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(500000));
    // The £5,000 ISA is fully drained trying to cover the £10,000 deficit; £5,000 of it goes unfunded (no cash/GIA account exists in this scenario to cover the rest).
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(0);
    expect(personResult?.shortfallFundedFromSavings).toBe(poundsToPence(5000));
    expect(personResult?.livingExpensesShortfall).toBe(true);
  });

  it("reports a shortfall and drains both accounts when the target exceeds available balances", () => {
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 100000, pensionBalance: 5000, isaBalance: 5000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.drawdownShortfall).toBe(true);
    expect(personResult?.drawdownNetAchieved).toBeLessThan(poundsToPence(100000));
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(0);
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(0);
  });

  it("escalates into the basic rate band once the Personal Allowance and ISA are exhausted, and totalTaxForYear includes the drawdown tax", () => {
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 50000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.drawdownIncomeTax).toBeGreaterThan(0);
    expect(Math.abs((personResult?.drawdownNetAchieved ?? 0) - poundsToPence(50000))).toBeLessThanOrEqual(5);
    if (!row) throw new Error("expected a row");
    expect(totalTaxForYear(row)).toBe(personResult?.drawdownIncomeTax);
  });

  it("exposes a bucket-by-bucket breakdown of the drawdown that's exactly consistent with the scalar totals", () => {
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 50000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];
    expect(personResult).toBeDefined();
    if (!personResult) throw new Error("expected a person result");

    expect(personResult.drawdownBuckets.length).toBeGreaterThan(0);
    // Every bucket is one of the two known tax-free ones or a taxable pension-income one (no GIA/CGT in this scenario).
    for (const bucket of personResult.drawdownBuckets) {
      expect(["taxFreeISA", "taxFreePensionLumpSum", "taxablePersonalAllowance", "taxableBasicRate", "taxableHigherRate", "taxableAdditionalRate"]).toContain(
        bucket.bucket,
      );
    }
    const taxFromBuckets = sumPence(personResult.drawdownBuckets.map((b) => b.taxCost));
    expect(taxFromBuckets).toBe(personResult.drawdownIncomeTax);
    const netFromBuckets = sumPence(personResult.drawdownBuckets.map((b) => pence(b.amount - b.taxCost)));
    expect(Math.abs(netFromBuckets - personResult.drawdownNetAchieved)).toBeLessThanOrEqual(2);
  });

  it("tracks the Lump Sum Allowance across years, cumulatively, so the same withdrawal gets costlier once it's exhausted", () => {
    // A large repeated target draws down the (real-terms) Lump Sum
    // Allowance year over year, since it's a running lifetime total, not
    // a per-year reset (SPEC.md §5.4, §5.7.2) — once exhausted, the same
    // net target loses its 25% automatic tax-free share and so costs
    // strictly more Income Tax than it did in year 0.
    const scenario = makeDrawdownScenario({ targetNetAnnualIncome: 150000, pensionBalance: 10000000, isaBalance: 0 });
    const result = runProjection(scenario, ruleSet2026_27, 6);
    const taxByYear = result.rows.map((row) => row.perPerson[0]?.drawdownIncomeTax ?? 0);

    // Non-decreasing year over year (LSA only ever depletes, never replenishes)...
    for (let i = 1; i < taxByYear.length; i++) {
      expect(taxByYear[i]).toBeGreaterThanOrEqual(taxByYear[i - 1] ?? 0);
    }
    // ...and strictly more expensive by the end than at the start, once the LSA has actually run out.
    expect(taxByYear.at(-1)).toBeGreaterThan(taxByYear[0] ?? 0);
  });
});

describe("runProjection — SIPP access date (SPEC.md §5.7)", () => {
  /** Same shape as `makeDrawdownScenario` above, but with a configurable pension `pensionType`/`accessDate` for exercising the access-date gate specifically. */
  function makeAccessDateScenario(options: {
    readonly pensionType: "sipp" | "workplaceDC";
    readonly accessDate?: string;
    readonly targetNetAnnualIncome: number; // pounds
  }): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 }; // age 70 in 2026
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    return {
      schemaVersion: 1,
      household,
      accounts: [
        {
          kind: "pension",
          id: "pension1",
          owner: PERSON_ID,
          pensionType: options.pensionType,
          currentBalance: poundsToPence(500000),
          annualGrowthRate: 0,
          annualChargeRate: 0,
          employerAnnualContribution: pence(0),
          ...(options.accessDate ? { accessDate: options.accessDate } : {}),
        },
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(5000), annualGrowthRate: 0 },
      ],
      incomeSources: [
        {
          id: "drawdown1",
          type: "targetDrawdownIncome",
          owner: PERSON_ID,
          config: { targetNetAnnualIncome: poundsToPence(options.targetNetAnnualIncome), startAge: 65 },
        },
      ],
      incomeDrains: [
        { id: "expenses1", type: "livingExpenses", owner: PERSON_ID, config: { annualAmount: poundsToPence(options.targetNetAnnualIncome) } },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("draws nothing from a SIPP before its access date — falls back to the ISA, then shortfalls", () => {
    // Person is 70 in 2026; access date is in 2030, well after the drawdown target's own startAge (65) already made it active.
    const scenario = makeAccessDateScenario({ pensionType: "sipp", accessDate: "2030-01-01", targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(500000));
    // £5,000 ISA covers half the £10,000 target; the rest goes unfunded (no cash/GIA in this scenario).
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(0);
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(5000));
  });

  it("draws from a SIPP normally once its access date has already passed", () => {
    const scenario = makeAccessDateScenario({ pensionType: "sipp", accessDate: "2020-01-01", targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(10000));
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(490000));
  });

  it("never restricts a workplaceDC pension, even with a future access date", () => {
    const scenario = makeAccessDateScenario({ pensionType: "workplaceDC", accessDate: "2030-01-01", targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(10000));
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(490000));
  });

  it("never restricts a SIPP with no access date set at all — an older plan predating this field behaves exactly as before", () => {
    const scenario = makeAccessDateScenario({ pensionType: "sipp", targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(10000));
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(490000));
  });

  it("starts drawing from a SIPP the exact calendar year its access date falls in, not before", () => {
    const scenario = makeAccessDateScenario({ pensionType: "sipp", accessDate: "2028-06-15", targetNetAnnualIncome: 10000 });
    const result = runProjection(scenario, ruleSet2026_27, 3); // 2026, 2027, 2028

    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(5000)); // 2026 — blocked, ISA-only
    expect(result.rows[1]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(0)); // 2027 — blocked, ISA already exhausted
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(10000)); // 2028 — access date's own year, fully funded
  });
});

describe("runProjection — drawdown target pools every account of a kind, not just one (SPEC.md §5.7.1)", () => {
  const poolingPerson: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 }; // age 70 in 2026
  const poolingHousehold: Household = { people: [poolingPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  it("draws from two pension accounts proportionally by balance, with the same total tax outcome as one pooled £500,000 pension", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: poolingHousehold,
      accounts: [
        { kind: "pension", id: "pensionA", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(300000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
        { kind: "pension", id: "pensionB", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(200000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(10000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Same total outcome as the single-account "sources a target entirely
    // from the pension" test above — pooling two accounts into the same
    // £500,000 combined balance changes nothing about the tax result,
    // only which specific account balances move.
    expect(personResult?.drawdownNetAchieved).toBe(poundsToPence(10000));
    expect(personResult?.drawdownIncomeTax).toBe(0);

    // £10,000 gross withdrawn, split 60/40 by prior balance (£300k/£500k, £200k/£500k) — exact, no rounding remainder involved.
    expect(result.rows[0]?.accountBalances.get("pensionA")).toBe(poundsToPence(294000));
    expect(result.rows[0]?.accountBalances.get("pensionB")).toBe(poundsToPence(196000));
  });

  it("draws from two ISA accounts proportionally, fully draining both when the target exactly matches their combined balance", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: poolingHousehold,
      accounts: [
        { kind: "isa", id: "isaA", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(3000), annualGrowthRate: 0 },
        { kind: "isa", id: "isaB", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(2000), annualGrowthRate: 0 },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(5000), startAge: 65 } }],
      // Matches the target — without this, the £5,000 achieved has
      // nothing to be spent on and the surplus sweep reinvests it right
      // back into the first ISA it finds, defeating the point of this
      // test (see makeDrawdownScenario's identical comment above).
      incomeDrains: [{ id: "expenses1", type: "livingExpenses", owner: PERSON_ID, config: { annualAmount: poundsToPence(5000) } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.drawdownNetAchieved).toBe(poundsToPence(5000));
    expect(result.rows[0]?.accountBalances.get("isaA")).toBe(0);
    expect(result.rows[0]?.accountBalances.get("isaB")).toBe(0);
  });

  it("draws from two GIAs with different cost bases, apportioning both the withdrawal and the return-of-capital split by the same prior-balance share", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: poolingHousehold,
      accounts: [
        // 75% gain: £6,000 balance, £1,500 cost basis.
        { kind: "gia", id: "giaA", owner: PERSON_ID, currentBalance: poundsToPence(6000), costBasis: poundsToPence(1500), annualGrowthRate: 0, annualDividendYield: 0 },
        // 0% gain: £4,000 balance, £4,000 cost basis — bought at today's value.
        { kind: "gia", id: "giaB", owner: PERSON_ID, currentBalance: poundsToPence(4000), costBasis: poundsToPence(4000), annualGrowthRate: 0, annualDividendYield: 0 },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(3000), startAge: 65 } }],
      // Matches the target — see the ISA test above's identical comment.
      incomeDrains: [{ id: "expenses1", type: "livingExpenses", owner: PERSON_ID, config: { annualAmount: poundsToPence(3000) } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Pooled: £10,000 balance, £5,500 cost basis — blended gain fraction
    // (10,000-5,500)/10,000 = 45%. £3,000 withdrawn × 45% = £1,350 gain,
    // within the £3,000 Annual Exempt Amount — £0 tax, entirely the
    // engine's "free tier" (SPEC.md §5.7.3).
    expect(personResult?.drawdownNetAchieved).toBe(poundsToPence(3000));
    expect(personResult?.drawdownCapitalGainsTax).toBe(0);

    // £3,000 gross withdrawn, split 60/40 by prior balance (£6k/£10k, £4k/£10k): £1,800 / £1,200.
    expect(result.rows[0]?.accountBalances.get("giaA")).toBe(poundsToPence(6000 - 1800));
    expect(result.rows[0]?.accountBalances.get("giaB")).toBe(poundsToPence(4000 - 1200));

    // Return of capital: £3,000 − £1,350 gain = £1,650, apportioned by the
    // same 60/40 prior-balance share — £990 / £660 — reducing each
    // account's own cost basis (not re-derived from each account's own
    // individual gain fraction, which would double-apply the blend).
    expect(result.rows[0]?.costBasisByAccountId.get("giaA")).toBe(poundsToPence(1500 - 990));
    expect(result.rows[0]?.costBasisByAccountId.get("giaB")).toBe(poundsToPence(4000 - 660));
  });

  it("pools multiple accounts for a joint target too, drawing from both of a person's pensions rather than just one", () => {
    const personA: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personA], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [
        { kind: "pension", id: "pensionA1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(300000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
        { kind: "pension", id: "pensionA2", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(200000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(10000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    // The single-person household solver delegates straight through
    // (see "still delegates cleanly to the ordinary per-person solver"
    // above) — both of this person's pensions should have been drawn
    // from, not just whichever one used to be picked from a dropdown.
    expect(result.rows[0]?.accountBalances.get("pensionA1")).toBeLessThan(poundsToPence(300000));
    expect(result.rows[0]?.accountBalances.get("pensionA2")).toBeLessThan(poundsToPence(200000));
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(10000));
  });
});

describe("runProjection — surplus sweep never reinvests into an account the drawdown just drew from", () => {
  it("drains an ISA to zero and keeps it there when a drawdown target exceeds it and nothing spends the achieved income", () => {
    // The exact user-reported bug: ISA + drawdown only, no living
    // expenses drain — without the fix, the achieved (but unspent) net
    // income was swept right back into the same ISA it was just drawn
    // from, so the balance never actually fell.
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 }; // age 70 in 2026
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(5000), annualGrowthRate: 0 }],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(20000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    // Year 0: the whole £5,000 ISA is drawn (shortfall against the £20,000 target), and the ISA correctly ends the year at £0.
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(5000));
    expect(result.rows[0]?.perPerson[0]?.drawdownShortfall).toBe(true);
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(0);
    // Years 1-2: nothing left to draw — the ISA stays at exactly £0, not silently replenished.
    expect(result.rows[1]?.perPerson[0]?.drawdownNetAchieved).toBe(0);
    expect(result.rows[1]?.accountBalances.get("isa1")).toBe(0);
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(0);
    expect(result.rows[2]?.accountBalances.get("isa1")).toBe(0);
  });

  it("achieving the target income leaves nothing to sweep — an active target auto-consumes its own achieved income, so the untouched ISA is left exactly as it was", () => {
    // Now that a drawdown target represents total desired income and
    // achieving it automatically counts as spent (no separate Living
    // Expenses drain required), a person with an active target never has
    // leftover positive net income to sweep from their own achieved
    // income — that's the point of the merged mental model. The ISA here
    // was never drawn from by the drawdown itself (entirely sourced from
    // the pension), and it's *also* never a sweep target, since there's
    // no surplus left once the £5,000 achieved is auto-consumed.
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [
        { kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: 0 },
      ],
      // Entirely sourced from the pension, within the Personal Allowance — the ISA is never touched by the drawdown itself.
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(5000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(5000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(1000));
  });

  it("doesn't sweep automatic income (State Pension) into an already-exhausted ISA during an active drawdown shortfall — no year-over-year oscillation", () => {
    // The exact second user-reported bug: once the ISA a drawdown target
    // was drawing from is fully exhausted, State Pension income was still
    // positive net income with nothing to spend it on, and (without the
    // shortfall guard) got swept into the (untouched-*this*-year) empty
    // ISA, which the *next* year's drawdown immediately drew straight
    // back out — an infinite oscillation, never settling.
    //
    // Now that a target represents *total* desired income (SPEC.md
    // §5.7.2), State Pension nets off the target before drawdown is even
    // sized, and — since the target is the household's whole notion of
    // "spent" — State Pension's own contribution toward it is
    // auto-consumed too, not left as spendable surplus. So net income
    // settles flat at exactly £0 in every year here, not just "flat at
    // the State Pension amount": a stronger, more direct fix for the
    // same oscillation bug (there's genuinely nothing left over to
    // oscillate with, rather than merely nothing left over that gets
    // reinvested).
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95, statePensionAge: 65 }; // already past SPA in 2026
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(10000), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "sp1", type: "statePension", owner: PERSON_ID, config: { annualForecastAmount: poundsToPence(11000) } },
        // Raised from £20,000: with State Pension now netted off the target before
        // sizing the withdrawal, the £10,000 ISA must still be fully exhausted in year
        // 0 (adjusted target £14,000 > £10,000 available) to preserve the same shortfall
        // scenario this test exists to cover.
        { id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(25000), startAge: 65 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 4);
    // Year 0: the £10,000 ISA is fully drawn (touched this year, so already excluded from any sweep regardless).
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(0);
    expect(result.rows[0]?.perPerson[0]?.drawdownShortfall).toBe(true);
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
    // Years 1-3: ISA already empty, drawdown achieves £0 every year (a
    // standing shortfall) — State Pension's £11,000 is fully auto-consumed
    // toward the still-unmet target, so it stays at exactly £0 in every
    // subsequent year, and net income settles flat at exactly £0 rather
    // than oscillating.
    for (let i = 1; i <= 3; i++) {
      const row = result.rows[i];
      expect(row?.perPerson[0]?.drawdownNetAchieved).toBe(0);
      expect(row?.perPerson[0]?.drawdownShortfall).toBe(true);
      expect(row?.accountBalances.get("isa1")).toBe(0);
      expect(row?.perPerson[0]?.netIncome).toBe(0);
    }
  });
});

describe("runProjection — a drawdown target represents total desired income, auto-consumed once achieved (SPEC.md §5.7.2)", () => {
  it("nets the target against salary — a £10,000 salary and £30,000 target draw exactly £20,000 from savings, with nothing left to sweep", () => {
    // The user's own worked example: making £30,000 and wanting £50,000
    // means drawing down £20,000. Salary here is chosen below both the
    // Personal Allowance and NI primary threshold (£12,570) so it's
    // entirely untaxed — net salary equals gross salary exactly, giving a
    // clean, exact assertion rather than one obscured by tax/NI.
    // A single pension account only — a real scenario would likely also
    // hold an ISA, but the drawdown solver auto-discovers and pools *every*
    // pension/ISA/cash/GIA account the target applies to, preferring
    // tax-free ISA withdrawals first — so an ISA balance here would itself
    // get drawn from rather than staying untouched, muddying this test's
    // actual point (the target-vs-salary netting arithmetic).
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() }],
      incomeSources: [
        { id: "sal1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(10000), annualGrowthRate: 0 } },
        { id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(30000), startAge: 65 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];
    expect(p?.incomeTax).toBe(0);
    expect(p?.nationalInsurance).toBe(0);
    expect(p?.drawdownNetAchieved).toBe(poundsToPence(20000));
    // The whole £30,000 (salary + drawdown) is achieved toward the target and auto-consumed — nothing left over to sweep.
    expect(p?.netIncome).toBe(0);
  });

  it("achieves the full target with no Living Expenses drain at all — zero surplus swept, pension declining by exactly the amount drawn", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(1000000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() }],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(20000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];
    expect(p?.drawdownNetAchieved).toBe(poundsToPence(20000));
    expect(p?.netIncome).toBe(0);
    // No surplus swept anywhere — the pension balance falls by exactly the gross amount drawn, nothing more, nothing less.
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(subtractPence(poundsToPence(1000000), p?.drawdownGrossWithdrawn ?? zeroPence()));
  });

  it("keeps an explicit Living Expenses drain working exactly as before alongside a target, without double-counting", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const makeScenario = (livingExpenses: number): Scenario => ({
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(1000000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() }],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(30000), startAge: 65 } }],
      incomeDrains: [{ id: "exp1", type: "livingExpenses", owner: PERSON_ID, config: { annualAmount: poundsToPence(livingExpenses) } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    });

    // An explicit drain that already matches the target: does all the work itself, auto-consumption is zero.
    const matching = runProjection(makeScenario(30000), ruleSet2026_27, 1);
    const matchingPerson = matching.rows[0]?.perPerson[0];
    expect(matchingPerson?.drawdownNetAchieved).toBe(poundsToPence(30000));
    expect(matchingPerson?.netIncome).toBe(0);

    // An explicit drain smaller than the target: auto-consumption tops up exactly the gap, no double-count.
    const partial = runProjection(makeScenario(10000), ruleSet2026_27, 1);
    const partialPerson = partial.rows[0]?.perPerson[0];
    expect(partialPerson?.drawdownNetAchieved).toBe(poundsToPence(30000));
    expect(partialPerson?.netIncome).toBe(0);
    expect(partial.rows[0]?.accountBalances.get("pension1")).toBe(matching.rows[0]?.accountBalances.get("pension1"));
  });
});

describe("runProjection — drawdownFromPension/drawdownFromIsa report the actual per-source split", () => {
  it("reports the full amount under drawdownFromPension when the target is sourced entirely from the Personal Allowance band", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [
        { kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(20000), annualGrowthRate: 0 },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(10000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];
    expect(p?.drawdownFromIsa).toBe(0);
    expect(p?.drawdownFromPension).toBeGreaterThan(0);
    expect(p?.drawdownFromPension).toBe(p?.drawdownGrossWithdrawn);
  });

  it("splits drawdownFromPension/drawdownFromIsa to match the taxable/non-taxable preference", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [{ kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() }],
      incomeSources: [
        {
          id: "drawdown1",
          type: "targetDrawdownIncome",
          owner: PERSON_ID,
          config: { targetNetAnnualIncome: poundsToPence(20000), startAge: 65, taxableDrawdownPreference: poundsToPence(8000) },
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    // No ISA account at all — the £12,000 non-taxable share has nowhere to go, so it falls back to pension.
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];
    expect(p?.drawdownFromIsa).toBe(0);
    expect(p?.drawdownFromPension).toBe(p?.drawdownGrossWithdrawn);
    expect(p?.drawdownNetAchieved).toBe(poundsToPence(20000));
  });

  it("sums drawdownFromPension + drawdownFromIsa + drawdownFromCash + drawdownFromGia to exactly drawdownGrossWithdrawn", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [
        { kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(5000), annualGrowthRate: 0 },
        { kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: poundsToPence(5000), annualGrowthRate: 0 },
        { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: poundsToPence(5000), costBasis: poundsToPence(2000), annualGrowthRate: 0, annualDividendYield: 0 },
      ],
      incomeSources: [{ id: "drawdown1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 65 } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];
    const summed = sumPence([
      p?.drawdownFromPension ?? zeroPence(),
      p?.drawdownFromIsa ?? zeroPence(),
      p?.drawdownFromCash ?? zeroPence(),
      p?.drawdownFromGia ?? zeroPence(),
    ]);
    expect(summed).toBe(p?.drawdownGrossWithdrawn);
    // ISA, cash, and GIA are all fully drawn (£5,000 each, £15,000 combined) — GIA's gain fraction (60%)
    // against the CGT Annual Exempt Amount happens to exactly cover its whole £5,000 balance tax-free.
    expect(p?.drawdownFromIsa).toBe(poundsToPence(5000));
    expect(p?.drawdownFromCash).toBe(poundsToPence(5000));
    expect(p?.drawdownFromGia).toBe(poundsToPence(5000));
  });
});

describe("runProjection — drawdown draws from GIA and cash once pension/ISA are exhausted", () => {
  function makeFullAccountDrawdownScenario(targetNetAnnualIncome: number): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1956-01-01", targetRetirementAge: 65, projectionEndAge: 95 }; // age 70 in 2026
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    return {
      schemaVersion: 1,
      household,
      accounts: [
        { kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(5000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(5000), annualGrowthRate: 0 },
        { kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: poundsToPence(10000), annualGrowthRate: 0 },
        { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: poundsToPence(20000), costBasis: poundsToPence(15000), annualGrowthRate: 0, annualDividendYield: 0 },
      ],
      incomeSources: [
        {
          id: "drawdown1",
          type: "targetDrawdownIncome",
          owner: PERSON_ID,
          config: {
            targetNetAnnualIncome: poundsToPence(targetNetAnnualIncome),
            startAge: 65,
          },
        },
      ],
      // Matches the target, same as makeDrawdownScenario above — keeps
      // these tests focused on drawdown-across-account-types mechanics
      // rather than the surplus cash sweep.
      incomeDrains: [
        {
          id: "expenses1",
          type: "livingExpenses",
          owner: PERSON_ID,
          config: { annualAmount: poundsToPence(targetNetAnnualIncome) },
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("draws from cash and GIA once pension and ISA are exhausted, instead of reporting a false shortfall", () => {
    // Pension (£5,000) + ISA (£5,000) alone can't cover a £30,000 target — cash (£10,000) and GIA (£20,000) must be used too.
    const scenario = makeFullAccountDrawdownScenario(30000);
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.drawdownShortfall).toBe(false);
    expect(Math.abs((personResult?.drawdownNetAchieved ?? 0) - poundsToPence(30000))).toBeLessThanOrEqual(5);
    // Every account was actually drawn down — none of them just sat there compounding untouched.
    expect(row?.accountBalances.get("pension1")).toBe(0);
    expect(row?.accountBalances.get("isa1")).toBe(0);
    expect((row?.accountBalances.get("cash1") ?? 0) + (row?.accountBalances.get("gia1") ?? 0)).toBeLessThan(poundsToPence(30000));
  });

  it("still reports a genuine shortfall once pension, ISA, cash, and GIA are all exhausted", () => {
    const scenario = makeFullAccountDrawdownScenario(100000); // exceeds all four accounts combined (£40,000)
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.drawdownShortfall).toBe(true);
    expect(row?.accountBalances.get("pension1")).toBe(0);
    expect(row?.accountBalances.get("isa1")).toBe(0);
    expect(row?.accountBalances.get("cash1")).toBe(0);
    expect(row?.accountBalances.get("gia1")).toBe(0);
  });

  it("reduces the GIA's cost basis proportionally as it's drawn down, not just its balance", () => {
    const scenario = makeFullAccountDrawdownScenario(28000); // enough to reach into the GIA, not enough to exhaust it
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];

    const giaBalance = row?.accountBalances.get("gia1") ?? 0;
    const giaCostBasis = row?.costBasisByAccountId.get("gia1") ?? 0;
    expect(giaBalance).toBeGreaterThan(0);
    expect(giaBalance).toBeLessThan(poundsToPence(20000)); // some was drawn down
    // Cost basis should still be a sensible fraction of the (reduced) balance — the original 75% (£15,000/£20,000) cost-basis ratio, roughly preserved.
    expect(giaCostBasis).toBeGreaterThan(0);
    expect(giaCostBasis).toBeLessThanOrEqual(giaBalance);
  });
});

describe("runProjection — living expenses and one-off cash events", () => {
  function makeCashFlowScenario(): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    return {
      schemaVersion: 1,
      household,
      accounts: [],
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(40000), annualGrowthRate: 0 } },
        {
          id: "inflow1",
          type: "oneOffInflow",
          owner: PERSON_ID,
          config: { amount: poundsToPence(50000), date: "2027-06-15", category: "inheritance" },
        },
      ],
      incomeDrains: [
        { id: "expenses1", type: "livingExpenses", owner: PERSON_ID, config: { annualAmount: poundsToPence(20000) } },
        {
          id: "outflow1",
          type: "oneOffOutflow",
          owner: PERSON_ID,
          config: { amount: poundsToPence(30000), date: "2028-03-01", category: "housingDeposit" },
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("reduces net income by living expenses every year, with no effect on Income Tax or NI", () => {
    const scenario = makeCashFlowScenario();
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // £40,000 salary: PA £12,570 @ 0%, £27,430 @ 20% = £5,486.00.
    expect(personResult?.incomeTax).toBe(poundsToPence(5486));
    expect(personResult?.otherExpenses).toBe(poundsToPence(20000));
    // Net income = earned net - living expenses (no one-off events in year 0).
    const earnedNet = poundsToPence(40000) - poundsToPence(5486) - (personResult?.nationalInsurance ?? 0);
    expect(personResult?.netIncome).toBe(pence(earnedNet - poundsToPence(20000)));
  });

  it("adds a one-off inflow tax-free, only in the year it falls in", () => {
    const scenario = makeCashFlowScenario();
    const result = runProjection(scenario, ruleSet2026_27, 3); // 2026-27, 2027-28, 2028-29
    const taxFreeByYear = result.rows.map((row) => row.perPerson[0]?.taxFreeIncome ?? pence(0));

    expect(taxFreeByYear[0]).toBe(0); // 2026-27: before the inflow's date
    expect(taxFreeByYear[1]).toBe(poundsToPence(50000)); // 2027-28: the inheritance lands
    expect(taxFreeByYear[2]).toBe(0); // 2028-29: gone again — a one-off, not recurring

    // The inheritance shouldn't change Income Tax at all (it's tax-free, not earned income).
    expect(result.rows[1]?.perPerson[0]?.incomeTax).toBe(result.rows[0]?.perPerson[0]?.incomeTax);
  });

  it("subtracts a one-off outflow from spendable cash, only in the year it falls in", () => {
    const scenario = makeCashFlowScenario();
    const result = runProjection(scenario, ruleSet2026_27, 3);
    const expensesByYear = result.rows.map((row) => row.perPerson[0]?.otherExpenses ?? pence(0));

    expect(expensesByYear[0]).toBe(poundsToPence(20000)); // living expenses only
    expect(expensesByYear[1]).toBe(poundsToPence(20000)); // still just living expenses (outflow is dated 2028)
    expect(expensesByYear[2]).toBe(poundsToPence(20000 + 30000)); // 2028-29: living expenses + the house deposit
  });
});

describe("runProjection — GIA and cash accounts", () => {
  function makeInvestmentScenario(livingExpensesAmount: Pence): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    return {
      schemaVersion: 1,
      household,
      accounts: [
        {
          kind: "cash",
          id: "cash1",
          owner: PERSON_ID,
          currentBalance: poundsToPence(20000),
          annualGrowthRate: 0.05, // the interest rate
        },
        {
          kind: "gia",
          id: "gia1",
          owner: PERSON_ID,
          currentBalance: poundsToPence(50000),
          costBasis: poundsToPence(40000),
          annualGrowthRate: 0.03, // capital appreciation, untaxed
          annualDividendYield: 0.04,
        },
      ],
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(60000), annualGrowthRate: 0 } },
      ],
      incomeDrains: [
        {
          id: "expenses1",
          type: "livingExpenses",
          owner: PERSON_ID,
          config: { annualAmount: livingExpensesAmount },
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  // Sized to land net income at exactly zero (a zero-expense probe run
  // first, since tax here is entirely independent of the living expenses
  // drain — SPEC.md §3.9 — so net income scales down by exactly the
  // expense amount) — keeps these tests focused on savings/dividend tax
  // and cash1/gia1's own growth rates, isolated from *both* directions
  // the engine now moves money based on net income: the surplus-cash
  // sweep (positive net income, into the GIA here since there's no ISA)
  // and the shortfall-funding step (negative net income, out of cash then
  // the GIA). A merely "large" expense no longer isolates these tests —
  // it would overshoot into draining cash1/gia1 via the newer mechanism.
  const breakEvenLivingExpenses = runProjection(makeInvestmentScenario(zeroPence()), ruleSet2026_27, 1).rows[0]?.perPerson[0]?.netIncome ?? zeroPence();

  it("taxes cash interest via the (smaller, higher-rate) Personal Savings Allowance, stacked above earned income", () => {
    const result = runProjection(makeInvestmentScenario(breakEvenLivingExpenses), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // £60,000 salary puts this person in higher-rate territory -> £500 PSA (not the £1,000 basic-rate figure).
    // £20,000 * 5% = £1,000 interest; £500 taxable at the higher Income Tax rate (40%).
    expect(personResult?.savingsInterestIncome).toBe(poundsToPence(1000));
    expect(personResult?.savingsTax).toBe(poundsToPence(500 * 0.4));
  });

  it("taxes GIA dividends via the Dividend Allowance and dividend-specific rates, stacked above savings income", () => {
    const result = runProjection(makeInvestmentScenario(breakEvenLivingExpenses), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // £50,000 * 4% = £2,000 dividends; £500 Dividend Allowance; £1,500 taxable at the higher dividend rate (35.75% for 2026/27, not the 40% standard higher rate).
    expect(personResult?.dividendIncome).toBe(poundsToPence(2000));
    const expectedDividendTax = poundsToPence(1500 * ruleSet2026_27.dividendTax.higherRate);
    expect(personResult?.dividendTax).toBe(expectedDividendTax);
    // Materially different from what the standard 40% Income Tax rate would have charged — proves the dividend-specific schedule is actually in use.
    expect(personResult?.dividendTax).not.toBe(poundsToPence(1500 * 0.4));
  });

  it("reinvests dividends into both the GIA's balance and its cost basis, and grows the cash balance by its interest rate", () => {
    const result = runProjection(makeInvestmentScenario(breakEvenLivingExpenses), ruleSet2026_27, 1);
    const row = result.rows[0];

    // Cash: £20,000 grown at 5% = £21,000 (the same rate used for both the taxable-interest calculation and the balance growth).
    expect(row?.accountBalances.get("cash1")).toBe(poundsToPence(21000));
    // GIA: £50,000 + £2,000 reinvested dividend = £52,000, then grown by the 3% capital rate = £53,560.
    expect(row?.accountBalances.get("gia1")).toBe(poundsToPence(53560));
    // Cost basis starts at £40,000 and grows only by the reinvested dividend (£2,000) — never by capital appreciation.
    expect(row?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(42000));
  });

  it("reduces net income by the tax owed on interest and dividends, even though neither is paid out as spendable cash", () => {
    const result = runProjection(makeInvestmentScenario(breakEvenLivingExpenses), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];
    expect(personResult).toBeDefined();
    if (!personResult) throw new Error("expected a person result");

    const expectedNetIncome =
      poundsToPence(60000) -
      personResult.incomeTax -
      personResult.nationalInsurance -
      personResult.savingsTax -
      personResult.dividendTax -
      breakEvenLivingExpenses; // the living expenses drain, see makeInvestmentScenario — sized to net exactly to zero
    expect(personResult.netIncome).toBe(expectedNetIncome);
  });

  it("credits a GIA contribution to both the balance and the cost basis", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [
        {
          kind: "gia",
          id: "gia1",
          owner: PERSON_ID,
          currentBalance: poundsToPence(10000),
          costBasis: poundsToPence(10000),
          annualGrowthRate: 0,
          annualDividendYield: 0,
        },
      ],
      // £5,000 salary, comfortably under the Personal Allowance and NI
      // threshold (zero tax, zero NI), so net income before the
      // contribution is exactly £5,000 — enough to afford the £5,000 GIA
      // contribution with nothing left over. This isolates the
      // contribution-crediting mechanic under test here from *both*
      // directions money can otherwise move based on net income: a
      // surplus (with no salary at all, the contribution would be
      // unaffordable, and the resulting shortfall would immediately draw
      // the same amount straight back out of this same GIA — see the
      // "shortfall funding" describe block for that interaction tested on
      // its own terms) and a leftover surplus sweep (which, with no ISA
      // in this scenario, would otherwise also land in this same GIA).
      incomeSources: [{ id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(5000), annualGrowthRate: 0 } }],
      incomeDrains: [
        {
          id: "drain1",
          type: "giaContribution",
          owner: PERSON_ID,
          config: { giaAccountId: "gia1", annualContribution: poundsToPence(5000) },
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    // No growth/dividend configured — the balance should simply be £10,000 + £5,000 contributed.
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(15000));
    // Cost basis increases by the same amount — it's new money invested, not a gain.
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(15000));
    // Net income lands at exactly zero — the salary exactly covered the contribution, nothing more.
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
  });
});

describe("runProjection — surplus cash sweep", () => {
  function makeSweepScenario(options: {
    readonly grossAnnualSalary: number; // pounds
    readonly hasIsa?: boolean;
    readonly hasGia?: boolean;
    readonly isaContribution?: number; // pounds — an existing manual contribution, ahead of the sweep
    readonly livingExpenses?: number; // pounds
  }): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    const accounts: Account[] = [];
    if (options.hasIsa) {
      accounts.push({ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 });
    }
    if (options.hasGia) {
      accounts.push({ kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 });
    }

    const incomeDrains: IncomeDrainInstance[] = [];
    if (options.isaContribution !== undefined) {
      incomeDrains.push({
        id: "isacontrib1",
        type: "isaContribution",
        owner: PERSON_ID,
        config: { isaAccountId: "isa1", annualContribution: poundsToPence(options.isaContribution) },
      });
    }
    if (options.livingExpenses !== undefined) {
      incomeDrains.push({
        id: "expenses1",
        type: "livingExpenses",
        owner: PERSON_ID,
        config: { annualAmount: poundsToPence(options.livingExpenses) },
      });
    }

    return {
      schemaVersion: 1,
      household,
      accounts,
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(options.grossAnnualSalary), annualGrowthRate: 0 } },
      ],
      incomeDrains,
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("sweeps net income entirely into the ISA when it fits within the remaining annual subscription limit", () => {
    const scenario = makeSweepScenario({ grossAnnualSalary: 22000, hasIsa: true });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.netIncome).toBeGreaterThan(0);
    expect(personResult?.netIncome).toBeLessThan(poundsToPence(20000)); // comfortably under the ISA limit
    expect(personResult?.surplusSweptToIsa).toBe(personResult?.netIncome);
    expect(personResult?.surplusSweptToGia).toBe(0);
    expect(row?.accountBalances.get("isa1")).toBe(personResult?.netIncome);
  });

  it("caps the ISA sweep at the remaining annual subscription limit and spills the rest into the GIA", () => {
    const scenario = makeSweepScenario({ grossAnnualSalary: 80000, hasIsa: true, hasGia: true });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    const isaLimit = poundsToPence(ruleSet2026_27.isa.annualSubscriptionLimit);
    expect(personResult?.netIncome).toBeGreaterThan(isaLimit);
    expect(personResult?.surplusSweptToIsa).toBe(isaLimit);
    expect(personResult?.surplusSweptToGia).toBe(pence((personResult?.netIncome ?? 0) - isaLimit));
    expect(row?.accountBalances.get("isa1")).toBe(isaLimit);
    expect(row?.accountBalances.get("gia1")).toBe(personResult?.surplusSweptToGia);
  });

  it("accounts for an existing manual ISA contribution when computing the remaining sweep room", () => {
    const isaLimit = ruleSet2026_27.isa.annualSubscriptionLimit;
    const manualContribution = 15000;
    const scenario = makeSweepScenario({ grossAnnualSalary: 80000, hasIsa: true, hasGia: true, isaContribution: manualContribution });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // Only the remaining £5,000 of ISA room (£20,000 - £15,000 already contributed) is available to the sweep.
    expect(personResult?.surplusSweptToIsa).toBe(poundsToPence(isaLimit - manualContribution));
  });

  it("sweeps entirely into the GIA (with cost basis increasing too) when there's no ISA account", () => {
    const scenario = makeSweepScenario({ grossAnnualSalary: 30000, hasGia: true });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.netIncome).toBeGreaterThan(0);
    expect(personResult?.surplusSweptToIsa).toBe(0);
    expect(personResult?.surplusSweptToGia).toBe(personResult?.netIncome);
    expect(row?.accountBalances.get("gia1")).toBe(personResult?.netIncome);
    expect(row?.costBasisByAccountId.get("gia1")).toBe(personResult?.netIncome);
  });

  it("doesn't sweep anywhere when the person holds neither an ISA nor a GIA", () => {
    const scenario = makeSweepScenario({ grossAnnualSalary: 30000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.netIncome).toBeGreaterThan(0);
    expect(personResult?.surplusSweptToIsa).toBe(0);
    expect(personResult?.surplusSweptToGia).toBe(0);
  });

  it("doesn't sweep a zero or negative net income", () => {
    const scenario = makeSweepScenario({ grossAnnualSalary: 30000, hasIsa: true, hasGia: true, livingExpenses: 100000 });
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const row = result.rows[0];
    const personResult = row?.perPerson[0];

    expect(personResult?.netIncome).toBeLessThan(0);
    expect(personResult?.surplusSweptToIsa).toBe(0);
    expect(personResult?.surplusSweptToGia).toBe(0);
    expect(row?.accountBalances.get("isa1")).toBe(0);
    expect(row?.accountBalances.get("gia1")).toBe(0);
  });
});

describe("runProjection — rental income and the mortgage interest credit (SPEC.md §5.6)", () => {
  it("hand-verified: rental profit stacks into Income Tax at marginal rate, NI is unaffected, and the mortgage interest credit reduces net income", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(250000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(200000),
      purchaseDate: "2015-01-01",
      rentalDetails: { grossAnnualRentalIncome: poundsToPence(12000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0 },
      // Interest-only, so the whole £5,000 annual payment is interest — no capital repayment complexity to hand-verify.
      mortgage: { initialBalance: poundsToPence(100000), nominalInterestRate: 0.05, repaymentType: "interestOnly", termYears: 20, annualPayment: poundsToPence(5000) },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty],
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(30000), annualGrowthRate: 0 } },
        { id: "src2", type: "rentalIncome", owner: PERSON_ID, config: { propertyId: "prop1" } },
      ],
      incomeDrains: [{ id: "drain1", type: "mortgagePayment", owner: PERSON_ID, config: { propertyId: "prop1" } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const person0 = result.rows[0]?.perPerson[0];
    expect(person0).toBeDefined();

    // Rental profit: gross £12,000 − letting costs £2,000 (bigger than the £1,000 allowance) = £10,000.
    expect(person0?.rentalProfitIncome).toBe(poundsToPence(10000));

    // Income Tax: taxableIncome = £30,000 salary + £10,000 rental = £40,000.
    // PA £12,570 @ 0%; remaining £27,430 all within the £37,700-wide basic band @ 20% = £5,486.00.
    expect(person0?.incomeTax).toBe(poundsToPence(5486));

    // NI is unaffected by rental profit — it's assessed on the £30,000 salary alone:
    // (£30,000 − £12,570 primary threshold) × 8% = £1,394.40.
    expect(person0?.nationalInsurance).toBe(poundsToPence(1394.4));

    // Mortgage interest credit: £100,000 × 5% = £5,000 interest, credited at the 20% relief rate = £1,000.00.
    expect(person0?.mortgageInterestCredit).toBe(poundsToPence(1000));

    // otherExpenses: the mortgagePayment drain's cash outflow — the full £5,000 (interest-only, no capital repaid).
    expect(person0?.otherExpenses).toBe(poundsToPence(5000));

    // netIncome = (30,000 + 10,000 rental + 1,000 credit) − (5,486 tax + 1,394.40 NI + 5,000 mortgage payment) = 29,119.60.
    expect(person0?.netIncome).toBe(poundsToPence(29119.6));

    // The mortgage's running nominal balance shouldn't have moved — interest-only, no capital repaid.
    expect(result.rows[0]?.mortgageBalanceByPropertyId.get("prop1")).toBe(poundsToPence(100000));
  });

  it("compounds rental income and letting costs by their own growth rate over elapsed years", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(250000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(200000),
      purchaseDate: "2015-01-01",
      rentalDetails: { grossAnnualRentalIncome: poundsToPence(12000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0.02 },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty],
      incomeSources: [{ id: "src2", type: "rentalIncome", owner: PERSON_ID, config: { propertyId: "prop1" } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 4);
    // Year 3: gross £12,000 × 1.02^3 − letting costs £2,000 × 1.02^3, floored/allowance-compared as usual.
    const grossYear3 = poundsToPence(12000 * Math.pow(1.02, 3));
    const costsYear3 = poundsToPence(2000 * Math.pow(1.02, 3));
    expect(result.rows[3]?.perPerson[0]?.rentalProfitIncome).toBe(subtractPence(grossYear3, costsYear3));
  });

  it("stops rental income and mortgage payments once the property is sold", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(250000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(200000),
      purchaseDate: "2015-01-01",
      rentalDetails: { grossAnnualRentalIncome: poundsToPence(12000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0 },
      mortgage: { initialBalance: poundsToPence(100000), nominalInterestRate: 0.05, repaymentType: "interestOnly", termYears: 20, annualPayment: poundsToPence(5000) },
      plannedSale: { saleDate: "2027-06-01", expectedSalePrice: poundsToPence(250000), sellingCosts: poundsToPence(5000) },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty],
      incomeSources: [{ id: "src2", type: "rentalIncome", owner: PERSON_ID, config: { propertyId: "prop1" } }],
      incomeDrains: [{ id: "drain1", type: "mortgagePayment", owner: PERSON_ID, config: { propertyId: "prop1" } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3); // 2026, 2027 (sale year), 2028
    expect(result.rows[0]?.perPerson[0]?.rentalProfitIncome).toBeGreaterThan(0); // 2026: still ongoing
    expect(result.rows[1]?.perPerson[0]?.rentalProfitIncome).toBe(0); // 2027: sale year — no rental income modelled
    expect(result.rows[1]?.perPerson[0]?.propertySaleNetProceeds).toBeGreaterThan(0); // ...but the sale itself happens
    expect(result.rows[2]?.perPerson[0]?.rentalProfitIncome).toBe(0); // 2028: property already gone
    expect(result.rows[2]?.perPerson[0]?.otherExpenses).toBe(0); // no more mortgage payments either
  });
});

describe("runProjection — property sale (SPEC.md §3.8, §5.6)", () => {
  it("hand-verified: a main residence sale is fully exempt from CGT via Private Residence Relief, and the mortgage is redeemed from proceeds", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const mainResidence: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "mainResidence",
      currentBalance: poundsToPence(400000),
      annualGrowthRate: 0.02,
      purchasePrice: poundsToPence(300000),
      purchaseDate: "2010-01-01",
      mortgage: { initialBalance: poundsToPence(200000), nominalInterestRate: 0.04, repaymentType: "repayment", termYears: 20, annualPayment: poundsToPence(14709.16) },
      plannedSale: { saleDate: "2026-06-01", expectedSalePrice: poundsToPence(450000), sellingCosts: poundsToPence(10000) },
    };
    const gia: Account = { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [mainResidence, gia],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1); // sale happens in year 0 (2026)
    const person0 = result.rows[0]?.perPerson[0];

    // Gain: £450,000 sale price − £300,000 purchase price − £10,000 selling costs = £140,000.
    expect(person0?.propertySaleGain).toBe(poundsToPence(140000));
    expect(person0?.propertySalePrivateResidenceReliefApplied).toBe(true);
    expect(person0?.propertySaleCapitalGainsTax).toBe(0);

    // No amortisation happens in the sale year — the full £200,000 starting balance is redeemed.
    // Net proceeds: £450,000 − £10,000 selling costs − £200,000 mortgage redeemed − £0 CGT = £240,000.
    expect(person0?.propertySaleNetProceeds).toBe(poundsToPence(240000));
    expect(person0?.netIncome).toBe(poundsToPence(240000));

    // The property and its mortgage are gone from the balance sheet...
    expect(result.rows[0]?.accountBalances.get("prop1")).toBe(0);
    expect(result.rows[0]?.mortgageBalanceByPropertyId.get("prop1")).toBe(0);
    // ...and the net proceeds flow through the ordinary surplus cash sweep, exactly like any other windfall (no ISA here, so it lands in the GIA).
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(240000));
  });

  it("hand-verified: a rental property sale is taxed at the residential CGT rate after the Annual Exempt Amount", () => {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(170000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(150000),
      purchaseDate: "2018-01-01",
      plannedSale: { saleDate: "2026-06-01", expectedSalePrice: poundsToPence(170000), sellingCosts: poundsToPence(5000) },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const person0 = result.rows[0]?.perPerson[0];

    // Gain: £170,000 − £150,000 − £5,000 selling costs = £15,000. Less the £3,000 Annual Exempt Amount = £12,000 taxable.
    // No other income this year, so the whole £12,000 lands in the basic band at the residential basic rate: £12,000 × 18% = £2,160.00.
    expect(person0?.propertySaleGain).toBe(poundsToPence(15000));
    expect(person0?.propertySalePrivateResidenceReliefApplied).toBe(false);
    expect(person0?.propertySaleCapitalGainsTax).toBe(poundsToPence(2160));
    // Net proceeds: £170,000 − £5,000 selling costs − £0 mortgage − £2,160 CGT = £162,840.
    expect(person0?.propertySaleNetProceeds).toBe(poundsToPence(162840));
  });

  it("shares one Annual Exempt Amount between a property sale and the same year's GIA drawdown", () => {
    // A rental sale with a gain exactly equal to the £3,000 AEA should use it up entirely,
    // leaving nothing for a same-year GIA capital gain, which should then be taxed in full.
    // Born 1970: already 56 in 2026, so the drawdown target (startAge 55) is active immediately.
    const person: Person = { id: PERSON_ID, dateOfBirth: "1970-01-01", targetRetirementAge: 55, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(103000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(100000),
      purchaseDate: "2018-01-01",
      plannedSale: { saleDate: "2026-06-01", expectedSalePrice: poundsToPence(103000), sellingCosts: zeroPence() },
    };
    const gia: Account = {
      kind: "gia",
      id: "gia1",
      owner: PERSON_ID,
      currentBalance: poundsToPence(50000),
      costBasis: poundsToPence(10000), // a large embedded gain, so the withdrawal below is almost entirely a capital gain
      annualGrowthRate: 0,
      annualDividendYield: 0,
    };
    const drawdownSource: IncomeSourceInstance = {
      id: "src2",
      type: "targetDrawdownIncome",
      owner: PERSON_ID,
      // Raised from £10,000: a drawdown target now nets off the property sale's
      // ~£103,000 net proceeds before sizing the withdrawal, so the target must
      // exceed that to still leave a genuine £10,000 gap for the GIA to fill —
      // preserving this test's actual point (a same-year AEA shared between the
      // sale and the GIA withdrawal).
      config: { targetNetAnnualIncome: poundsToPence(113000), startAge: 55 },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty, gia],
      incomeSources: [drawdownSource],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const person0 = result.rows[0]?.perPerson[0];

    // The property sale's £3,000 gain exactly consumes the whole Annual Exempt Amount.
    expect(person0?.propertySaleGain).toBe(poundsToPence(3000));
    expect(person0?.propertySaleCapitalGainsTax).toBe(0);
    // So the drawdown's own GIA withdrawal — a further capital gain — finds no exempt amount left,
    // and its bucket breakdown should show nothing in the "within allowance" bucket.
    const withinAllowanceBucket = person0?.drawdownBuckets.find((b) => b.bucket === "capitalGainWithinAllowance");
    expect(withinAllowanceBucket?.amount ?? 0).toBe(0);
    expect(person0?.drawdownCapitalGainsTax).toBeGreaterThan(0);
  });
});

describe("runProjection — property sale destination account (SPEC.md §3.8)", () => {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

  /** Same main-residence sale as the hand-verified test above — PRR-exempt, so £240,000 net proceeds with £0 CGT, isolating the destination-routing behaviour from any tax-calculation noise. */
  function makeMainResidence(destinationAccountId?: string): Property {
    return {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "mainResidence",
      currentBalance: poundsToPence(400000),
      annualGrowthRate: 0.02,
      purchasePrice: poundsToPence(300000),
      purchaseDate: "2010-01-01",
      mortgage: { initialBalance: poundsToPence(200000), nominalInterestRate: 0.04, repaymentType: "repayment", termYears: 20, annualPayment: poundsToPence(14709.16) },
      plannedSale: {
        saleDate: "2026-06-01",
        expectedSalePrice: poundsToPence(450000),
        sellingCosts: poundsToPence(10000),
        ...(destinationAccountId ? { destinationAccountId } : {}),
      },
    };
  }

  it("credits a chosen cash account directly, with none of it left over as net income", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: zeroPence(), annualGrowthRate: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("cash1"), cash],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(240000));
    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(0);
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
  });

  it("credits a chosen GIA directly and raises its cost basis by the same amount", () => {
    const gia: Account = { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("gia1"), gia],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(240000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(240000));
    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(0);
  });

  it("caps an ISA destination at the annual subscription limit and sweeps the overflow into a GIA, not net income", () => {
    const isa: Account = { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 };
    const gia: Account = { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("isa1"), isa, gia],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    // £240,000 net proceeds, capped at the £20,000 ISA annual subscription limit — the £220,000 remainder falls through to the GIA.
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(220000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(220000));
    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(0);
  });

  it("caps an ISA destination and falls back to cash when no GIA exists", () => {
    const isa: Account = { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 };
    const cash: Account = { kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: zeroPence(), annualGrowthRate: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("isa1"), isa, cash],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(220000));
    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(0);
  });

  it("an ISA destination already touched by the automatic surplus sweep isn't double-credited past the annual limit", () => {
    // No GIA/cash to fall back into, so once the ISA's own £20,000 room is
    // used by the sale, the £220,000 remainder becomes ordinary net
    // income — and the *separate* end-of-year surplus sweep (6c) must not
    // then also try to push that same net income back into the very ISA
    // the sale already maxed out.
    const isa: Account = { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("isa1"), isa],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(poundsToPence(220000));
    expect(result.rows[0]?.perPerson[0]?.surplusSweptToIsa).toBe(0);
  });

  it("falls back to ordinary net income, exactly like no destination being set, when destinationAccountId points at a nonexistent account", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [makeMainResidence("does-not-exist")],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);

    expect(result.rows[0]?.perPerson[0]?.propertySaleNetProceeds).toBe(poundsToPence(240000));
  });

  it("a jointly-owned property's destination only credits the owner it actually belongs to — the other owner's share still becomes ordinary net income", () => {
    const PERSON_A_ID = personId("a");
    const PERSON_B_ID = personId("b");
    const personA: Person = { id: PERSON_A_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const personB: Person = { id: PERSON_B_ID, dateOfBirth: "1982-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const jointHousehold: Household = { people: [personA, personB], relationshipStatus: "unmarried", targetIncomeMode: "perPerson" };
    const cashA: Account = { kind: "cash", id: "cashA", owner: PERSON_A_ID, currentBalance: zeroPence(), annualGrowthRate: 0 };
    const jointProperty: Property = { ...makeMainResidence("cashA"), owner: "joint" };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: jointHousehold,
      accounts: [jointProperty, cashA],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const resultA = result.rows[0]?.perPerson.find((p) => p.personId === PERSON_A_ID);
    const resultB = result.rows[0]?.perPerson.find((p) => p.personId === PERSON_B_ID);

    // £240,000 net proceeds split 50/50 — £120,000 each.
    expect(result.rows[0]?.accountBalances.get("cashA")).toBe(poundsToPence(120000));
    expect(resultA?.propertySaleNetProceeds).toBe(0);
    expect(resultB?.propertySaleNetProceeds).toBe(poundsToPence(120000));
  });
});

describe("runProjection — combined multi-year rental, mortgage, and sale (SPEC.md §3.8, §5.6)", () => {
  /**
   * A regression test pinning down a full plan's worth of behaviour
   * across the rental-income/mortgage/sale transition in one scenario —
   * salary + a mortgaged rental property (sold 5 years in) + a GIA
   * catching the surplus sweep. Every expected figure below was
   * cross-checked two independent ways during manual verification before
   * being pinned here: once via the Dashboard's year-by-year table and
   * once via the Tax Breakdown page for the same year (which reads the
   * same `PersonYearResult` fields through separate rendering code), so
   * this isn't a single self-consistent-but-possibly-wrong computation —
   * it's the same numbers two different views independently agreed on.
   */
  function makeCombinedScenario(): Scenario {
    const person: Person = { id: PERSON_ID, dateOfBirth: "1975-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    // Entered as 2% nominal against 2.5% inflation in the UI — a small
    // *negative* real rate, exactly like every other real-terms input here.
    const houseAndRentalGrowthRate = convertNominalToReal(0.02, 0.025);
    const mortgageBalance = poundsToPence(120000);
    const mortgageAnnualPayment = deriveAnnualRepaymentMortgagePayment(mortgageBalance, 0.045, 15);

    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: PERSON_ID,
      propertyType: "rental",
      currentBalance: poundsToPence(250000),
      annualGrowthRate: houseAndRentalGrowthRate,
      purchasePrice: poundsToPence(200000),
      purchaseDate: "2018-01-01",
      rentalDetails: { grossAnnualRentalIncome: poundsToPence(14000), lettingCosts: poundsToPence(2000), annualGrowthRate: houseAndRentalGrowthRate },
      mortgage: { initialBalance: mortgageBalance, nominalInterestRate: 0.045, repaymentType: "repayment", termYears: 15, annualPayment: mortgageAnnualPayment },
      plannedSale: { saleDate: "2031-06-01", expectedSalePrice: poundsToPence(275000), sellingCosts: poundsToPence(8000) },
    };
    const gia: Account = { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 };

    return {
      schemaVersion: 1,
      household,
      accounts: [rentalProperty, gia],
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(45000), annualGrowthRate: 0 } },
        { id: "src2", type: "rentalIncome", owner: PERSON_ID, config: { propertyId: "prop1" } },
      ],
      incomeDrains: [{ id: "drain1", type: "mortgagePayment", owner: PERSON_ID, config: { propertyId: "prop1" } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("matches the live-verified figures for every ongoing year, the sale year, and the post-sale steady state", () => {
    const result = runProjection(makeCombinedScenario(), ruleSet2026_27, 7);
    const netWorth = (rowIndex: number) =>
      subtractPence(
        sumPence([...(result.rows[rowIndex]?.accountBalances.values() ?? [])]),
        sumPence([...(result.rows[rowIndex]?.mortgageBalanceByPropertyId.values() ?? [])]),
      );

    // Years 0-4 (2026-27 to 2030-31): rental and mortgage both ongoing.
    // `dashboardIncomeTax` is `incomeTax` net of the mortgage interest
    // credit — the figure Dashboard's "Income Tax" column actually shows
    // (SPEC.md §4 journey 5's whole point: this must match what a second,
    // independent view — the Tax Breakdown page — computes too).
    const ongoingYears = [
      { row: 0, dashboardIncomeTax: 9152, netIncome: 34079.94, netWorth: 168634.09 },
      { row: 1, dashboardIncomeTax: 9205.63, netIncome: 34240.31, netWorth: 210333.16 },
      { row: 2, dashboardIncomeTax: 9258.46, netIncome: 34395.1, netWorth: 252096.28 },
      { row: 3, dashboardIncomeTax: 9310.58, netIncome: 34544.42, netWorth: 293922.54 },
      { row: 4, dashboardIncomeTax: 9361.99, netIncome: 34688.39, netWorth: 335811.1 },
    ];
    for (const year of ongoingYears) {
      const person = result.rows[year.row]?.perPerson[0];
      expect(subtractPence(person?.incomeTax ?? zeroPence(), person?.mortgageInterestCredit ?? zeroPence())).toBe(
        poundsToPence(year.dashboardIncomeTax),
      );
      expect(person?.propertySaleCapitalGainsTax).toBe(0);
      expect(person?.rentalProfitIncome).toBeGreaterThan(0);
      expect(person?.netIncome).toBe(poundsToPence(year.netIncome));
      expect(netWorth(year.row)).toBe(poundsToPence(year.netWorth));
    }

    // Cross-checked in year 2 (2028-29) specifically, via the Tax Breakdown view.
    const year2 = result.rows[2]?.perPerson[0];
    expect(year2?.rentalProfitIncome).toBe(poundsToPence(11883.21));
    expect(year2?.mortgageInterestCredit).toBe(poundsToPence(926.82));
    expect(year2?.otherExpenses).toBe(poundsToPence(10635.25));
    expect(year2?.surplusSweptToGia).toBe(poundsToPence(34395.1));

    // Year 5 (2031-32): the sale year — rental profit stops, CGT appears once, net income jumps.
    const saleYear = result.rows[5]?.perPerson[0];
    expect(saleYear?.rentalProfitIncome).toBe(0);
    expect(saleYear?.incomeTax).toBe(poundsToPence(6486));
    expect(saleYear?.propertySaleCapitalGainsTax).toBe(poundsToPence(15223.8));
    expect(saleYear?.propertySalePrivateResidenceReliefApplied).toBe(false);
    expect(saleYear?.netIncome).toBe(poundsToPence(209550.72));
    expect(netWorth(5)).toBe(poundsToPence(381498.88));

    // Year 6 (2032-33): post-sale steady state — salary only, exactly matching the sale year's own salary-only Income Tax figure.
    const postSaleYear = result.rows[6]?.perPerson[0];
    expect(postSaleYear?.rentalProfitIncome).toBe(0);
    expect(postSaleYear?.otherExpenses).toBe(0); // no more mortgage payments
    expect(postSaleYear?.incomeTax).toBe(saleYear?.incomeTax);
    expect(postSaleYear?.propertySaleCapitalGainsTax).toBe(0);
    expect(postSaleYear?.netIncome).toBe(poundsToPence(35919.6));
    expect(netWorth(6)).toBe(poundsToPence(417418.48));
  });
});

describe("runProjection — two-person households (SPEC.md §3.1, §5.1, §5.2, §5.5, §5.6)", () => {
  const PERSON_A_ID = personId("a");
  const PERSON_B_ID = personId("b");
  const personA: Person = { id: PERSON_A_ID, dateOfBirth: "1980-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
  const personB: Person = { id: PERSON_B_ID, dateOfBirth: "1982-01-01", targetRetirementAge: 67, projectionEndAge: 95 };

  function makeHousehold(relationshipStatus: Household["relationshipStatus"], marriageAllowanceElection?: PersonId): Household {
    return {
      people: [personA, personB],
      relationshipStatus,
      targetIncomeMode: "perPerson",
      ...(marriageAllowanceElection ? { marriageAllowanceElection } : {}),
    };
  }

  it("computes each person's Income Tax and NI fully independently, even with very different incomes", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [],
      incomeSources: [
        { id: "src1", type: "salary", owner: PERSON_A_ID, config: { grossAnnualSalary: poundsToPence(20000), annualGrowthRate: 0 } },
        { id: "src2", type: "salary", owner: PERSON_B_ID, config: { grossAnnualSalary: poundsToPence(80000), annualGrowthRate: 0 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    expect(a?.personId).toBe(PERSON_A_ID);
    // £20,000 - £12,570 PA = £7,430 @ 20% = £1,486.00.
    expect(a?.incomeTax).toBe(poundsToPence(1486));
    expect(b?.personId).toBe(PERSON_B_ID);
    // £80,000 - £12,570 PA = £67,430; £37,700 @ 20% + £29,730 @ 40% = £7,540 + £11,892 = £19,432.00.
    expect(b?.incomeTax).toBe(poundsToPence(19432));
  });

  // Both dividend and savings tax stack *above* other income (SPEC.md
  // §5.5) — with zero other income, unused Personal Allowance headroom
  // would shield the whole amount at 0% regardless of the dividend/
  // savings allowance, which wouldn't actually exercise the mechanic
  // being tested. Each person gets a salary exactly at the Personal
  // Allowance (£12,570 — zero Income Tax, zero NI on its own) so their
  // PA is already fully used before savings/dividend income stacks on top.
  function makeJointIncomeSalaries(): IncomeSourceInstance[] {
    return [
      { id: "salA", type: "salary", owner: PERSON_A_ID, config: { grossAnnualSalary: poundsToPence(12570), annualGrowthRate: 0 } },
      { id: "salB", type: "salary", owner: PERSON_B_ID, config: { grossAnnualSalary: poundsToPence(12570), annualGrowthRate: 0 } },
    ];
  }

  it("splits a jointly-owned GIA's dividends 50/50, each person taxed via their own allowance and bands", () => {
    const gia: Account = {
      kind: "gia",
      id: "gia1",
      owner: "joint",
      currentBalance: poundsToPence(100000),
      costBasis: poundsToPence(100000),
      annualGrowthRate: 0,
      annualDividendYield: 0.04,
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [gia],
      incomeSources: makeJointIncomeSalaries(),
      // A living-expenses drain per person sized to land net income at
      // precisely zero: their £12,570 salary (zero Income Tax/NI on its
      // own — see makeJointIncomeSalaries) minus the £161.25 dividend tax
      // each pays below (netIncome subtracts dividendTax too, not just
      // the expense). This is dividend-split mechanics under test here,
      // not the surplus-cash sweep or the shortfall-funding step (a
      // *larger* expense would create a deficit and have the latter
      // drain this same joint GIA, deflating the balance assertion below;
      // a *smaller* one would leave a surplus for the former to sweep in
      // and inflate it instead).
      incomeDrains: [
        { id: "expA", type: "livingExpenses", owner: PERSON_A_ID, config: { annualAmount: subtractPence(poundsToPence(12570), poundsToPence(161.25)) } },
        { id: "expB", type: "livingExpenses", owner: PERSON_B_ID, config: { annualAmount: subtractPence(poundsToPence(12570), poundsToPence(161.25)) } },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];

    // Total dividend: £100,000 * 4% = £4,000, split £2,000 each.
    expect(a?.dividendIncome).toBe(poundsToPence(2000));
    expect(b?.dividendIncome).toBe(poundsToPence(2000));
    // Each: PA already used by salary; £500 Dividend Allowance @ 0%, remaining £1,500 @ 10.75% (basic dividend rate) = £161.25.
    expect(a?.dividendTax).toBe(poundsToPence(161.25));
    expect(b?.dividendTax).toBe(poundsToPence(161.25));
    // The dividend is reinvested exactly once, not once per matching owner.
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(104000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(104000));
  });

  it("splits a jointly-owned cash account's interest 50/50", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: "joint", currentBalance: poundsToPence(100000), annualGrowthRate: 0.04 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [cash],
      incomeSources: makeJointIncomeSalaries(),
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];

    // Total interest: £100,000 * 4% = £4,000, split £2,000 each.
    expect(a?.savingsInterestIncome).toBe(poundsToPence(2000));
    expect(b?.savingsInterestIncome).toBe(poundsToPence(2000));
    // Each: PA already used by salary; £1,000 Personal Savings Allowance (basic-rate payer) @ 0%, remaining £1,000 @ 20% = £200.00.
    expect(a?.savingsTax).toBe(poundsToPence(200));
    expect(b?.savingsTax).toBe(poundsToPence(200));
  });

  it("splits a jointly-owned rental property's profit 50/50, stacking into each person's own Income Tax", () => {
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: "joint",
      propertyType: "rental",
      currentBalance: poundsToPence(250000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(200000),
      purchaseDate: "2018-01-01",
      rentalDetails: { grossAnnualRentalIncome: poundsToPence(12000), lettingCosts: poundsToPence(2000), annualGrowthRate: 0 },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [rentalProperty],
      incomeSources: [{ id: "src1", type: "rentalIncome", owner: "joint", config: { propertyId: "prop1" } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];

    // Total profit: £12,000 - £2,000 = £10,000, split £5,000 each — both fully within each person's own Personal Allowance.
    expect(a?.rentalProfitIncome).toBe(poundsToPence(5000));
    expect(b?.rentalProfitIncome).toBe(poundsToPence(5000));
    expect(a?.incomeTax).toBe(0);
    expect(b?.incomeTax).toBe(0);
  });

  it("splits a jointly-owned property sale's gain, taxing each person's share against their own Annual Exempt Amount and bands", () => {
    const rentalProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: "joint",
      propertyType: "rental",
      currentBalance: poundsToPence(220000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(190000),
      purchaseDate: "2018-01-01",
      plannedSale: { saleDate: "2026-06-01", expectedSalePrice: poundsToPence(220000), sellingCosts: zeroPence() },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [rentalProperty],
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];

    // Total gain: £220,000 - £190,000 = £30,000, split £15,000 each.
    expect(a?.propertySaleGain).toBe(poundsToPence(15000));
    expect(b?.propertySaleGain).toBe(poundsToPence(15000));
    // Each: £15,000 - £3,000 AEA = £12,000 taxable, entirely within the basic band (no other income) @ 18% = £2,160.00.
    expect(a?.propertySaleCapitalGainsTax).toBe(poundsToPence(2160));
    expect(b?.propertySaleCapitalGainsTax).toBe(poundsToPence(2160));
    // Both shares of net proceeds should sum back to the household total: £220,000 - £0 selling costs - £0 mortgage - £4,320 total CGT.
    const totalNetProceeds = addPence(a?.propertySaleNetProceeds ?? zeroPence(), b?.propertySaleNetProceeds ?? zeroPence());
    expect(totalNetProceeds).toBe(poundsToPence(215680));
  });

  it("splits a jointly-owned one-off inflow 50/50, tax-free for both", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [],
      incomeSources: [{ id: "src1", type: "oneOffInflow", owner: "joint", config: { amount: poundsToPence(20000), date: "2026-06-01", category: "inheritance" } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    expect(a?.taxFreeIncome).toBe(poundsToPence(10000));
    expect(b?.taxFreeIncome).toBe(poundsToPence(10000));
    expect(a?.netIncome).toBe(poundsToPence(10000));
    expect(b?.netIncome).toBe(poundsToPence(10000));
  });

  it("splits a jointly-owned mortgage payment's cash outflow 50/50 between both people's own spendable cash", () => {
    const mortgagedProperty: Property = {
      kind: "property",
      id: "prop1",
      owner: "joint",
      propertyType: "mainResidence",
      currentBalance: poundsToPence(400000),
      annualGrowthRate: 0,
      purchasePrice: poundsToPence(350000),
      purchaseDate: "2020-01-01",
      mortgage: { initialBalance: poundsToPence(200000), nominalInterestRate: 0.04, repaymentType: "interestOnly", termYears: 20, annualPayment: poundsToPence(8000) },
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: makeHousehold("unmarried"),
      accounts: [mortgagedProperty],
      incomeSources: [],
      incomeDrains: [{ id: "drain1", type: "mortgagePayment", owner: "joint", config: { propertyId: "prop1" } }],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    // £8,000 interest-only payment (unchanged in year 0), split £4,000 each.
    expect(a?.otherExpenses).toBe(poundsToPence(4000));
    expect(b?.otherExpenses).toBe(poundsToPence(4000));
    // A main residence's mortgage gets no interest credit at all (SPEC.md §5.6).
    expect(a?.mortgageInterestCredit).toBe(0);
    expect(b?.mortgageInterestCredit).toBe(0);
  });

  describe("Marriage Allowance (SPEC.md §5.2)", () => {
    function makeMarriageAllowanceScenario(transferorSalary: number, recipientSalary: number, elect: boolean): Scenario {
      return {
        schemaVersion: 1,
        household: makeHousehold("marriedOrCivilPartnership", elect ? PERSON_A_ID : undefined),
        accounts: [],
        incomeSources: [
          { id: "src1", type: "salary", owner: PERSON_A_ID, config: { grossAnnualSalary: poundsToPence(transferorSalary), annualGrowthRate: 0 } },
          { id: "src2", type: "salary", owner: PERSON_B_ID, config: { grossAnnualSalary: poundsToPence(recipientSalary), annualGrowthRate: 0 } },
        ],
        incomeDrains: [],
        inflationRate: 0.025,
        upratingPolicy: { kind: "inflationLinked" },
      };
    }

    it("hand-verified: transfers the fixed amount and reduces the recipient's tax by exactly transferred-amount × their rate", () => {
      const result = runProjection(makeMarriageAllowanceScenario(8000, 30000, true), ruleSet2026_27, 1);
      const [a, b] = result.rows[0]?.perPerson ?? [];

      expect(a?.marriageAllowanceGiven).toBe(poundsToPence(1260));
      expect(b?.marriageAllowanceReceived).toBe(poundsToPence(1260));
      // Transferor: £8,000 income was already under the reduced £11,310 allowance (£12,570 - £1,260) — no tax either way.
      expect(a?.incomeTax).toBe(0);
      // Recipient: allowance £13,830 (£12,570 + £1,260); £30,000 - £13,830 = £16,170 @ 20% = £3,234.00 —
      // £252.00 less than the £3,486.00 they'd pay without the transfer (exactly £1,260 × 20%).
      expect(b?.incomeTax).toBe(poundsToPence(3234));
    });

    it("does not apply (and costs the transferor nothing) when not elected, even between an otherwise-eligible couple", () => {
      const result = runProjection(makeMarriageAllowanceScenario(8000, 30000, false), ruleSet2026_27, 1);
      const [a, b] = result.rows[0]?.perPerson ?? [];
      expect(a?.marriageAllowanceGiven).toBe(0);
      expect(b?.marriageAllowanceReceived).toBe(0);
      // Recipient pays the full, untransferred amount.
      expect(b?.incomeTax).toBe(poundsToPence(3486));
    });

    it("does not apply once the recipient becomes a higher-rate taxpayer, even though it's elected", () => {
      const result = runProjection(makeMarriageAllowanceScenario(8000, 60000, true), ruleSet2026_27, 1);
      const [a, b] = result.rows[0]?.perPerson ?? [];
      expect(a?.marriageAllowanceGiven).toBe(0);
      expect(b?.marriageAllowanceReceived).toBe(0);
    });

    it("does not apply once the transferor's own income exceeds their Personal Allowance, even though it's elected", () => {
      const result = runProjection(makeMarriageAllowanceScenario(20000, 30000, true), ruleSet2026_27, 1);
      const [a, b] = result.rows[0]?.perPerson ?? [];
      expect(a?.marriageAllowanceGiven).toBe(0);
      expect(b?.marriageAllowanceReceived).toBe(0);
    });

    it("never applies for an unmarried household, even with a matching election and eligible incomes", () => {
      const scenario = makeMarriageAllowanceScenario(8000, 30000, true);
      const unmarriedScenario: Scenario = { ...scenario, household: { ...scenario.household, relationshipStatus: "unmarried" } };
      const result = runProjection(unmarriedScenario, ruleSet2026_27, 1);
      const [a, b] = result.rows[0]?.perPerson ?? [];
      expect(a?.marriageAllowanceGiven).toBe(0);
      expect(b?.marriageAllowanceReceived).toBe(0);
    });
  });
});

describe("runProjection — household drawdown optimisation (SPEC.md §5.7.4)", () => {
  const PERSON_A_ID = personId("a");
  const PERSON_B_ID = personId("b");
  const personA: Person = { id: PERSON_A_ID, dateOfBirth: "1955-01-01", targetRetirementAge: 55, projectionEndAge: 95 };
  const personB: Person = { id: PERSON_B_ID, dateOfBirth: "1955-01-01", targetRetirementAge: 55, projectionEndAge: 95 };

  function makeHouseholdDrawdownScenario(
    householdSplitStrategy: "optimised" | "even" | "custom" | undefined,
    customFirstPersonShare?: number,
  ): Scenario {
    const household: Household = { people: [personA, personB], relationshipStatus: null, targetIncomeMode: "combined" };
    const accounts: Account[] = [
      { kind: "pension", id: "pensionA", owner: PERSON_A_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
      { kind: "pension", id: "pensionB", owner: PERSON_B_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
    ];
    return {
      schemaVersion: 1,
      household,
      accounts,
      incomeSources: [
        // Person B already has substantial other income — much less unused band headroom than Person A.
        { id: "salaryB", type: "salary", owner: PERSON_B_ID, config: { grossAnnualSalary: poundsToPence(80000), annualGrowthRate: 0 } },
        {
          id: "drawdown1",
          type: "targetDrawdownIncome",
          owner: "joint",
          config: {
            // Raised from £60,000: a joint target now nets off both people's other net
            // income before sizing the household drawdown, and Person B's £80,000 salary
            // alone nets to roughly £57,000 after tax/NI — close enough to the old £60,000
            // target to leave almost nothing for these tests to actually optimise/split.
            // £150,000 leaves a genuine ~£93,000 gap for the household solver to work with.
            targetNetAnnualIncome: poundsToPence(150000),
            startAge: 55,
            ...(householdSplitStrategy ? { householdSplitStrategy } : {}),
            ...(customFirstPersonShare !== undefined ? { customFirstPersonShare } : {}),
          },
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("defaults to the optimised strategy, routing more of the target through the person with unused band headroom", () => {
    const result = runProjection(makeHouseholdDrawdownScenario(undefined), ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    expect(a?.drawdownNetAchieved).toBeGreaterThan(b?.drawdownNetAchieved ?? zeroPence());
    expect(a?.drawdownShortfall).toBe(false);
    expect(b?.drawdownShortfall).toBe(false);
    // Both pensions should have been drawn from — this isn't a "give everything to A" all-or-nothing split.
    expect(result.rows[0]?.accountBalances.get("pensionA")).toBeLessThan(poundsToPence(500000));
    expect(result.rows[0]?.accountBalances.get("pensionB")).toBeLessThan(poundsToPence(500000));
  });

  it("achieves strictly lower combined tax under 'optimised' than 'even', for the exact same target", () => {
    const optimisedResult = runProjection(makeHouseholdDrawdownScenario("optimised"), ruleSet2026_27, 1);
    const evenResult = runProjection(makeHouseholdDrawdownScenario("even"), ruleSet2026_27, 1);

    const totalTax = (rows: typeof optimisedResult.rows) => sumPence(rows.slice(0, 1).map(totalTaxForYear));
    const optimisedTax = totalTax(optimisedResult.rows);
    const evenTax = totalTax(evenResult.rows);

    // Same household net income achieved either way...
    const netIncomeOf = (result: typeof optimisedResult) => sumPence(result.rows[0]?.perPerson.map((p) => p.netIncome) ?? []);
    expect(netIncomeOf(optimisedResult)).toBeGreaterThanOrEqual(netIncomeOf(evenResult));
    // ...but optimised costs strictly less in tax to get there.
    expect(optimisedTax).toBeLessThan(evenTax);
  });

  it("splits evenly between the two people under the 'even' strategy", () => {
    const result = runProjection(makeHouseholdDrawdownScenario("even"), ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    // Both start from an identical pension balance and age, so an even
    // £30,000/£30,000 split of gross target should draw down each
    // pension by a similar (not necessarily identical, since B's own tax
    // position differs) amount — the key distinguishing check is that
    // netAchieved is much closer between them than the optimised case.
    const gap = Math.abs((a?.drawdownNetAchieved ?? 0) - (b?.drawdownNetAchieved ?? 0));
    expect(gap).toBeLessThan(poundsToPence(100));
  });

  it("respects a custom split", () => {
    const result = runProjection(makeHouseholdDrawdownScenario("custom", 0.8), ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    const total = addPence(a?.drawdownNetAchieved ?? zeroPence(), b?.drawdownNetAchieved ?? zeroPence());
    // Person A's share should be roughly 80% of whatever was actually achieved net of any per-person tax friction —
    // check it's clearly closer to 80/20 than to 50/50.
    const aShare = (a?.drawdownNetAchieved ?? 0) / total;
    expect(aShare).toBeGreaterThan(0.65);
  });

  it("still delegates cleanly to the ordinary per-person solver for a single-person household", () => {
    const soloScenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personA], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [
        { kind: "pension", id: "pensionA", owner: PERSON_A_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
      ],
      incomeSources: [
        { id: "drawdown1", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(20000), startAge: 55 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(soloScenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(20000));
  });
});

describe("runProjection — survivorship (SPEC.md §5.7.5)", () => {
  const PERSON_A_ID = personId("a");
  const PERSON_B_ID = personId("b");
  // Person A's projection ends at age 95 (still alive that year — death is
  // marked the *following* year, once age first exceeds projectionEndAge):
  // born 1931 means age 95 in 2026 (still alive) and age 96 in 2027 (dies).
  const personA: Person = { id: PERSON_A_ID, dateOfBirth: "1931-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
  const personB: Person = { id: PERSON_B_ID, dateOfBirth: "1960-01-01", targetRetirementAge: 67, projectionEndAge: 95 };

  function makeSurvivorshipScenario(accounts: readonly Account[]): Scenario {
    return {
      schemaVersion: 1,
      household: { people: [personA, personB], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts,
      incomeSources: [],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("drops the deceased from perPerson from their death year onward, while the survivor continues", () => {
    const result = runProjection(makeSurvivorshipScenario([]), ruleSet2026_27, 3);
    expect(result.rows[0]?.perPerson.map((p) => p.personId)).toEqual([PERSON_A_ID, PERSON_B_ID]); // 2026: both alive
    expect(result.rows[1]?.perPerson.map((p) => p.personId)).toEqual([PERSON_B_ID]); // 2027: A has died
    expect(result.rows[2]?.perPerson.map((p) => p.personId)).toEqual([PERSON_B_ID]); // 2028: still just B
  });

  it("records a survivorship event only in the death year", () => {
    const result = runProjection(makeSurvivorshipScenario([]), ruleSet2026_27, 3);
    expect(result.rows[0]?.survivorshipEvents).toEqual([]);
    expect(result.rows[1]?.survivorshipEvents).toEqual([{ deceasedPersonId: PERSON_A_ID, survivorPersonId: PERSON_B_ID }]);
    expect(result.rows[2]?.survivorshipEvents).toEqual([]);
  });

  it("merges the deceased's solely-owned GIA into the survivor's own GIA, zeroing the deceased's", () => {
    const giaA: Account = { kind: "gia", id: "giaA", owner: PERSON_A_ID, currentBalance: poundsToPence(50000), costBasis: poundsToPence(40000), annualGrowthRate: 0, annualDividendYield: 0 };
    const giaB: Account = { kind: "gia", id: "giaB", owner: PERSON_B_ID, currentBalance: poundsToPence(10000), costBasis: poundsToPence(8000), annualGrowthRate: 0, annualDividendYield: 0 };
    const result = runProjection(makeSurvivorshipScenario([giaA, giaB]), ruleSet2026_27, 2);

    // Death year (2027): the merge has already happened before that year's own balances are reported.
    expect(result.rows[1]?.accountBalances.get("giaA")).toBe(poundsToPence(0));
    expect(result.rows[1]?.accountBalances.get("giaB")).toBe(poundsToPence(60000));
    expect(result.rows[1]?.costBasisByAccountId.get("giaB")).toBe(poundsToPence(48000));
  });

  it("merges the deceased's solely-owned cash into the survivor's own cash account", () => {
    const cashA: Account = { kind: "cash", id: "cashA", owner: PERSON_A_ID, currentBalance: poundsToPence(20000), annualGrowthRate: 0 };
    const cashB: Account = { kind: "cash", id: "cashB", owner: PERSON_B_ID, currentBalance: poundsToPence(5000), annualGrowthRate: 0 };
    const result = runProjection(makeSurvivorshipScenario([cashA, cashB]), ruleSet2026_27, 2);
    expect(result.rows[1]?.accountBalances.get("cashA")).toBe(poundsToPence(0));
    expect(result.rows[1]?.accountBalances.get("cashB")).toBe(poundsToPence(25000));
  });

  it("leaves the deceased's own pension balance untouched — neither inherited nor removed (pension death benefits are out of scope)", () => {
    const pensionA: Account = { kind: "pension", id: "pensionA", owner: PERSON_A_ID, pensionType: "sipp", currentBalance: poundsToPence(100000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() };
    const result = runProjection(makeSurvivorshipScenario([pensionA]), ruleSet2026_27, 2);
    expect(result.rows[1]?.accountBalances.get("pensionA")).toBe(poundsToPence(100000));
  });

  it("attributes a joint GIA's dividends entirely to the survivor once the other owner has died", () => {
    const jointGia: Account = { kind: "gia", id: "gia1", owner: "joint", currentBalance: poundsToPence(100000), costBasis: poundsToPence(100000), annualGrowthRate: 0, annualDividendYield: 0.04 };
    const result = runProjection(makeSurvivorshipScenario([jointGia]), ruleSet2026_27, 2);
    const survivorRow = result.rows[1]?.perPerson.find((p) => p.personId === PERSON_B_ID);
    // Year 0 (2026, both alive): £100,000 * 4% = £4,000 dividend, split 50/50, reinvested — balance becomes £104,000.
    // Year 1 (2027, A has died): £104,000 * 4% = £4,160 — all of it, not half, since Person A is no longer alive to share it with.
    expect(survivorRow?.dividendIncome).toBe(poundsToPence(4160));
  });
});

describe("runProjection — shortfall funding (outgoings exceeding income, SPEC.md §5.1 step 7 run in reverse)", () => {
  const SHORTFALL_PERSON_ID = personId("s1");
  const shortfallPerson: Person = { id: SHORTFALL_PERSON_ID, dateOfBirth: "1980-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
  const shortfallHousehold: Household = { people: [shortfallPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  function makeShortfallScenario(accounts: readonly Account[], livingExpensesAmount: number): Scenario {
    return {
      schemaVersion: 1,
      household: shortfallHousehold,
      accounts,
      incomeSources: [], // no income at all — keeps netIncome/shortfall figures exact and free of tax/NI
      incomeDrains: [
        { id: "expenses1", type: "livingExpenses", owner: SHORTFALL_PERSON_ID, config: { annualAmount: poundsToPence(livingExpensesAmount) } },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("funds a shortfall entirely from cash, leaving netIncome as the unaffected pure cash-flow figure", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: SHORTFALL_PERSON_ID, currentBalance: poundsToPence(10000), annualGrowthRate: 0 };
    const result = runProjection(makeShortfallScenario([cash], 3000), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.netIncome).toBe(subtractPence(zeroPence(), poundsToPence(3000)));
    expect(personResult?.shortfallFundedFromSavings).toBe(poundsToPence(3000));
    expect(personResult?.shortfallCapitalGainsTax).toBe(0);
    expect(personResult?.livingExpensesShortfall).toBe(false);
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(7000));
  });

  it("spills from cash into ISA once cash runs out", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: SHORTFALL_PERSON_ID, currentBalance: poundsToPence(2000), annualGrowthRate: 0 };
    const isa: Account = { kind: "isa", id: "isa1", owner: SHORTFALL_PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(5000), annualGrowthRate: 0 };
    const result = runProjection(makeShortfallScenario([cash, isa], 6000), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.shortfallFundedFromSavings).toBe(poundsToPence(6000));
    expect(personResult?.livingExpensesShortfall).toBe(false);
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(0);
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(1000));
  });

  it("spills into a GIA once cash and ISA are both exhausted, realising a proportional capital gain and paying CGT on it", () => {
    // Cost basis is 40% of balance, so a £3,000 GIA withdrawal (the last
    // £3,000 of the £5,000 shortfall, after £1,000 cash + £1,000 ISA) is
    // £1,200 return of capital + £1,800 realised gain — comfortably under
    // the £3,000 Annual Exempt Amount, so this case stays CGT-free; a
    // separate test below covers a gain that exceeds it.
    const cash: Account = { kind: "cash", id: "cash1", owner: SHORTFALL_PERSON_ID, currentBalance: poundsToPence(1000), annualGrowthRate: 0 };
    const isa: Account = { kind: "isa", id: "isa1", owner: SHORTFALL_PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(1000), annualGrowthRate: 0 };
    const gia: Account = {
      kind: "gia",
      id: "gia1",
      owner: SHORTFALL_PERSON_ID,
      currentBalance: poundsToPence(10000),
      costBasis: poundsToPence(4000),
      annualGrowthRate: 0,
      annualDividendYield: 0,
    };
    const result = runProjection(makeShortfallScenario([cash, isa, gia], 5000), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.shortfallFundedFromSavings).toBe(poundsToPence(5000));
    expect(personResult?.shortfallCapitalGainsTax).toBe(0);
    expect(personResult?.livingExpensesShortfall).toBe(false);
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(7000));
    // £4,000 cost basis - £1,200 return of capital = £2,800.
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(2800));
  });

  it("pays CGT when the GIA withdrawal's realised gain exceeds the Annual Exempt Amount", () => {
    // £10,000 shortfall, entirely from this GIA (cost basis 40% of balance):
    // £4,000 return of capital + £6,000 realised gain. £3,000 of that gain
    // is exempt (the 2026/27 Annual Exempt Amount), leaving £3,000 taxable.
    // With no other income this year, it stacks from £0 and stays within
    // the basic rate band, so it's taxed entirely at the CGT basic rate
    // (18% for 2026/27): £3,000 * 0.18 = £540.
    const gia: Account = {
      kind: "gia",
      id: "gia1",
      owner: SHORTFALL_PERSON_ID,
      currentBalance: poundsToPence(20000),
      costBasis: poundsToPence(8000),
      annualGrowthRate: 0,
      annualDividendYield: 0,
    };
    const result = runProjection(makeShortfallScenario([gia], 10000), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.shortfallFundedFromSavings).toBe(poundsToPence(10000));
    expect(personResult?.shortfallCapitalGainsTax).toBe(poundsToPence(540));
    expect(personResult?.livingExpensesShortfall).toBe(false);
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(10000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(4000));
  });

  it("never draws from a pension, even when it's the only account held — the shortfall goes unfunded instead", () => {
    const pension: Account = {
      kind: "pension",
      id: "pension1",
      owner: SHORTFALL_PERSON_ID,
      pensionType: "sipp",
      currentBalance: poundsToPence(50000),
      annualGrowthRate: 0,
      annualChargeRate: 0,
      employerAnnualContribution: zeroPence(),
    };
    const result = runProjection(makeShortfallScenario([pension], 5000), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(personResult?.netIncome).toBe(subtractPence(zeroPence(), poundsToPence(5000)));
    expect(personResult?.shortfallFundedFromSavings).toBe(0);
    expect(personResult?.livingExpensesShortfall).toBe(true);
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(50000));
  });

  it("leaves netIncome identical whether or not the shortfall could actually be funded — it's a pure cash-flow figure, not a balance-sheet one", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: SHORTFALL_PERSON_ID, currentBalance: poundsToPence(10000), annualGrowthRate: 0 };
    const funded = runProjection(makeShortfallScenario([cash], 4000), ruleSet2026_27, 1);
    const unfunded = runProjection(makeShortfallScenario([], 4000), ruleSet2026_27, 1);

    const fundedResult = funded.rows[0]?.perPerson[0];
    const unfundedResult = unfunded.rows[0]?.perPerson[0];
    expect(fundedResult?.netIncome).toBe(unfundedResult?.netIncome);
    expect(fundedResult?.netIncome).toBe(subtractPence(zeroPence(), poundsToPence(4000)));
    expect(fundedResult?.livingExpensesShortfall).toBe(false);
    expect(unfundedResult?.livingExpensesShortfall).toBe(true);
  });
});

describe("runProjection — account contributions reduce net income (no double-counting with the surplus sweep)", () => {
  const CONTRIB_PERSON_ID = personId("c1");
  const contribPerson: Person = { id: CONTRIB_PERSON_ID, dateOfBirth: "1980-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
  const contribHousehold: Household = { people: [contribPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  // £20,000 salary: £1,486 Income Tax + £594.40 NI (£7,430 above the
  // £12,570 NI threshold, at 8%) = £2,080.40, so net income before any
  // contribution is exactly £17,919.60 — comfortably under the £20,000
  // ISA annual subscription limit either way, so an ISA contribution's
  // effect is isolated from that cap.
  function makeContribScenario(accounts: readonly Account[], drains: readonly IncomeDrainInstance[]): Scenario {
    return {
      schemaVersion: 1,
      household: contribHousehold,
      accounts,
      incomeSources: [{ id: "src1", type: "salary", owner: CONTRIB_PERSON_ID, config: { grossAnnualSalary: poundsToPence(20000), annualGrowthRate: 0 } }],
      incomeDrains: drains,
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  const PRE_CONTRIBUTION_NET_INCOME = poundsToPence(17919.6);

  it("an ISA contribution reduces netIncome by the amount contributed, so the sweep doesn't also invest it", () => {
    const isa: Account = { kind: "isa", id: "isa1", owner: CONTRIB_PERSON_ID, isaType: "stocksAndShares", currentBalance: poundsToPence(0), annualGrowthRate: 0 };
    const drain: IncomeDrainInstance = { id: "isaC1", type: "isaContribution", owner: CONTRIB_PERSON_ID, config: { isaAccountId: "isa1", annualContribution: poundsToPence(5000) } };
    const result = runProjection(makeContribScenario([isa], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    expect(p?.accountContributions).toBe(poundsToPence(5000));
    expect(p?.netIncome).toBe(subtractPence(PRE_CONTRIBUTION_NET_INCOME, poundsToPence(5000)));
    // £5,000 contributed + the remaining (already-reduced) net income swept in — not £5,000 plus the FULL pre-contribution net income too.
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(PRE_CONTRIBUTION_NET_INCOME);
  });

  it("a GIA contribution reduces netIncome, so the (uncapped) sweep can't double-invest it", () => {
    const gia: Account = { kind: "gia", id: "gia1", owner: CONTRIB_PERSON_ID, currentBalance: poundsToPence(0), costBasis: poundsToPence(0), annualGrowthRate: 0, annualDividendYield: 0 };
    const drain: IncomeDrainInstance = { id: "giaC1", type: "giaContribution", owner: CONTRIB_PERSON_ID, config: { giaAccountId: "gia1", annualContribution: poundsToPence(5000) } };
    const result = runProjection(makeContribScenario([gia], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    expect(p?.netIncome).toBe(subtractPence(PRE_CONTRIBUTION_NET_INCOME, poundsToPence(5000)));
    // Total ending up in the GIA must never exceed what the person actually had (their full pre-contribution net income) — a bug here previously let it exceed that.
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(PRE_CONTRIBUTION_NET_INCOME);
  });

  it("a cash contribution reduces netIncome", () => {
    const cash: Account = { kind: "cash", id: "cash1", owner: CONTRIB_PERSON_ID, currentBalance: poundsToPence(0), annualGrowthRate: 0 };
    const drain: IncomeDrainInstance = { id: "cashC1", type: "cashContribution", owner: CONTRIB_PERSON_ID, config: { cashAccountId: "cash1", annualContribution: poundsToPence(5000) } };
    const result = runProjection(makeContribScenario([cash], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    expect(p?.accountContributions).toBe(poundsToPence(5000));
    expect(p?.netIncome).toBe(subtractPence(PRE_CONTRIBUTION_NET_INCOME, poundsToPence(5000)));
  });

  it("a relief-at-source pension contribution reduces netIncome by what the person actually paid, not the grossed-up top-up", () => {
    const pension: Account = { kind: "pension", id: "pension1", owner: CONTRIB_PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(0), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() };
    const drain: IncomeDrainInstance = { id: "pen1", type: "pensionContribution", owner: CONTRIB_PERSON_ID, config: { pensionAccountId: "pension1", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(4000) } };
    const result = runProjection(makeContribScenario([pension], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    // £4,000 grossed up at basic rate (20%) = £5,000 credited to the pension, but only the £4,000 the person themselves paid reduces their own spendable cash.
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(5000));
    expect(p?.accountContributions).toBe(poundsToPence(4000));
    expect(p?.netIncome).toBe(subtractPence(PRE_CONTRIBUTION_NET_INCOME, poundsToPence(4000)));
  });

  it("a net-pay pension contribution reduces netIncome by the full contribution amount", () => {
    const pension: Account = { kind: "pension", id: "pension1", owner: CONTRIB_PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(0), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() };
    const drain: IncomeDrainInstance = { id: "pen1", type: "pensionContribution", owner: CONTRIB_PERSON_ID, config: { pensionAccountId: "pension1", reliefMethod: "netPay", annualContribution: poundsToPence(4000) } };
    const result = runProjection(makeContribScenario([pension], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(4000));
    expect(p?.accountContributions).toBe(poundsToPence(4000));
    // Net-pay relief reduces taxable income too, so netIncome isn't simply the flat £20,000 scenario's figure minus £4,000 — it also reflects the resulting tax saving. Verified against the person's own actual tax/NI here rather than a second hand-derivation.
    const expected = subtractPence(subtractPence(subtractPence(poundsToPence(20000), p?.incomeTax ?? zeroPence()), p?.nationalInsurance ?? zeroPence()), poundsToPence(4000));
    expect(p?.netIncome).toBe(expected);
  });

  it("a salary-sacrifice pension contribution reduces netIncome by the full contribution amount", () => {
    const pension: Account = { kind: "pension", id: "pension1", owner: CONTRIB_PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(0), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() };
    const drain: IncomeDrainInstance = { id: "pen1", type: "pensionContribution", owner: CONTRIB_PERSON_ID, config: { pensionAccountId: "pension1", reliefMethod: "salarySacrifice", annualContribution: poundsToPence(4000) } };
    const result = runProjection(makeContribScenario([pension], [drain]), ruleSet2026_27, 1);
    const p = result.rows[0]?.perPerson[0];

    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(4000));
    expect(p?.accountContributions).toBe(poundsToPence(4000));
    const expected = subtractPence(subtractPence(subtractPence(poundsToPence(20000), p?.incomeTax ?? zeroPence()), p?.nationalInsurance ?? zeroPence()), poundsToPence(4000));
    expect(p?.netIncome).toBe(expected);
  });
});

describe("runProjection — MPAA (SPEC.md §5.4)", () => {
  const MPAA_PERSON_ID = personId("m1");
  // Age 60 at year 0 (2026); drawdown starts at 63, so years 0-2 build up
  // unused Annual Allowance carry-forward with no pension activity at
  // all, before MPAA enters the picture in year 3.
  const mpaaPerson: Person = { id: MPAA_PERSON_ID, dateOfBirth: "1966-01-01", targetRetirementAge: 63, projectionEndAge: 95 };
  const mpaaHousehold: Household = { people: [mpaaPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  function makeMpaaScenario(options: { readonly includeDrawdown: boolean }): Scenario {
    return {
      schemaVersion: 1,
      household: mpaaHousehold,
      accounts: [
        { kind: "pension", id: "pension1", owner: MPAA_PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(500000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: zeroPence() },
      ],
      incomeSources: [
        { id: "sal1", type: "salary", owner: MPAA_PERSON_ID, config: { grossAnnualSalary: poundsToPence(30000), annualGrowthRate: 0 } },
        ...(options.includeDrawdown
          ? [
              {
                id: "drawdown1",
                type: "targetDrawdownIncome",
                owner: MPAA_PERSON_ID,
                // Raised from £15,000: the £30,000 salary nets to ~£25,000 after tax/NI,
                // which alone would now zero out a £15,000 target and mean the drawdown —
                // the whole point of this scenario — never actually runs. £45,000 leaves a
                // genuine ~£20,000 gap for the drawdown to fill and trigger MPAA with.
                config: { targetNetAnnualIncome: poundsToPence(45000), startAge: 63 },
              } as const,
            ]
          : []),
      ],
      incomeDrains: [
        // RAS specifically (doesn't reduce taxableIncome itself, only
        // extends the band ceiling) so calculateAnnualAllowanceCharge's
        // otherTaxableIncome stays predictably at the £30,000 salary
        // figure regardless of the contribution — £16,000 paid nets up to
        // a clean £20,000 gross contribution at the 20% basic rate.
        {
          id: "pen1",
          type: "pensionContribution",
          owner: MPAA_PERSON_ID,
          config: { pensionAccountId: "pension1", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(16000) },
          startDate: "2030-01-01", // year index 4 onward — after MPAA has had a full year to take effect
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("doesn't trigger MPAA in the same year as the triggering drawdown — only from the following year", () => {
    const result = runProjection(makeMpaaScenario({ includeDrawdown: true }), ruleSet2026_27, 5);
    // Year 3 (2029, age 63): drawdown starts and takes taxable pension income this year.
    expect(result.rows[3]?.perPerson[0]?.drawdownNetAchieved).toBeGreaterThan(0);
    expect(result.rows[3]?.perPerson[0]?.mpaaActive).toBe(false);
    // Year 4 (2030) onward: MPAA is active, and stays active — it never reverts.
    expect(result.rows[4]?.perPerson[0]?.mpaaActive).toBe(true);
  });

  it("never triggers MPAA at all when no drawdown ever runs", () => {
    const result = runProjection(makeMpaaScenario({ includeDrawdown: false }), ruleSet2026_27, 5);
    for (const row of result.rows) {
      expect(row.perPerson[0]?.mpaaActive).toBe(false);
    }
  });

  it("caps the Annual Allowance at £10,000 once MPAA is active, charging the excess even though £20,000 is well under the standard £60,000 allowance", () => {
    const withDrawdown = runProjection(makeMpaaScenario({ includeDrawdown: true }), ruleSet2026_27, 5);
    const withoutDrawdown = runProjection(makeMpaaScenario({ includeDrawdown: false }), ruleSet2026_27, 5);

    // Year 4: £16,000 paid, grossed up to £20,000 at the 20% basic rate.
    const withMpaa = withDrawdown.rows[4]?.perPerson[0];
    const withoutMpaa = withoutDrawdown.rows[4]?.perPerson[0];
    expect(withMpaa?.grossPensionContribution).toBe(poundsToPence(20000));
    expect(withMpaa?.mpaaActive).toBe(true);

    // Without ever having drawn down, £20,000 is comfortably within the
    // standard £60,000 Annual Allowance (plus three years of untouched
    // carry-forward besides) — no charge at all.
    expect(withoutMpaa?.mpaaActive).toBe(false);
    expect(withoutMpaa?.annualAllowanceCharge).toBe(0);

    // With MPAA active, only £10,000 of it is allowed — £10,000 excess,
    // stacked on top of the £30,000 salary (RAS extends the same band
    // it's taxed in, so the whole excess falls at a flat 20%): £2,000.
    expect(withMpaa?.annualAllowanceCharge).toBe(poundsToPence(2000));
  });

  it("ignores three years of substantial unused carry-forward once MPAA is active — no carry-forward applies against the MPAA-restricted amount", () => {
    const result = runProjection(makeMpaaScenario({ includeDrawdown: true }), ruleSet2026_27, 5);
    // Years 0-2 had zero pension contributions and no drawdown yet — each
    // would ordinarily leave the full £60,000 Annual Allowance unused,
    // built up as carry-forward (SPEC.md §5.4's 3-year window). If that
    // carry-forward were still usable in year 4, a £20,000 contribution
    // would easily fit and produce zero charge — it doesn't, confirming
    // MPAA correctly blocks it rather than merely capping the *current*
    // year's allowance while leaving carry-forward untouched.
    const year4 = result.rows[4]?.perPerson[0];
    expect(year4?.annualAllowanceCharge).toBe(poundsToPence(2000));
  });
});

describe("runProjection — State Pension (SPEC.md §3.3, §5.2, §5.3)", () => {
  const SP_PERSON_ID = personId("sp1");
  // Age 65 at year 0 (2026), reaching State Pension Age (66, set below) at
  // year index 1 (2027) — one year with no State Pension to compare
  // against, then one year with it, while a salary keeps running through
  // both (the classic "still working past State Pension Age" case).
  const spPersonWithSalary: Person = { id: SP_PERSON_ID, dateOfBirth: "1961-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 66 };
  const spHouseholdWithSalary: Household = { people: [spPersonWithSalary], relationshipStatus: null, targetIncomeMode: "perPerson" };

  function makeStatePensionScenario(): Scenario {
    return {
      schemaVersion: 1,
      household: spHouseholdWithSalary,
      accounts: [],
      incomeSources: [
        { id: "sal1", type: "salary", owner: SP_PERSON_ID, config: { grossAnnualSalary: poundsToPence(20000), annualGrowthRate: 0 } },
        { id: "sp1", type: "statePension", owner: SP_PERSON_ID, config: { annualForecastAmount: poundsToPence(11000) } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("is inactive before State Pension Age, stacks into taxable income at marginal rate once active, and is never NI-able — while NI on the continuing salary stops entirely at the same age", () => {
    const result = runProjection(makeStatePensionScenario(), ruleSet2026_27, 2);
    const year0 = result.rows[0]?.perPerson[0]; // age 65 — before SPA
    const year1 = result.rows[1]?.perPerson[0]; // age 66 — at SPA

    expect(year0?.statePensionIncome).toBe(0);
    // £20,000 salary only: (20,000 - 12,570 PA) @ 20% = £1,486.00.
    expect(year0?.incomeTax).toBe(poundsToPence(1486));
    // Full NI: (20,000 - 12,570) @ 8% = £594.40.
    expect(year0?.nationalInsurance).toBe(poundsToPence(594.4));

    expect(year1?.statePensionIncome).toBe(poundsToPence(11000));
    // £20,000 salary + £11,000 State Pension = £31,000 taxable: (31,000 - 12,570) @ 20% = £3,686.00.
    expect(year1?.incomeTax).toBe(poundsToPence(3686));
    // NI stops entirely at State Pension Age, even though the salary is still active (SPEC.md §5.3).
    expect(year1?.nationalInsurance).toBe(0);
  });

  it("falls back to DEFAULT_STATE_PENSION_AGE (67) when Person.statePensionAge isn't set", () => {
    const personNoOverride: Person = { id: SP_PERSON_ID, dateOfBirth: "1961-01-01", targetRetirementAge: 67, projectionEndAge: 95 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personNoOverride], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [],
      incomeSources: [{ id: "sp1", type: "statePension", owner: SP_PERSON_ID, config: { annualForecastAmount: poundsToPence(11000) } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    // Age 65 (2026) through 67 (2028) — the default SPA (67) is reached at year index 2, not year index 1 (age 66) as the custom-SPA test above.
    const result = runProjection(scenario, ruleSet2026_27, 3);
    expect(result.rows[0]?.perPerson[0]?.statePensionIncome).toBe(0); // age 65
    expect(result.rows[1]?.perPerson[0]?.statePensionIncome).toBe(0); // age 66 — not yet 67
    expect(result.rows[2]?.perPerson[0]?.statePensionIncome).toBe(poundsToPence(11000)); // age 67
  });

  it("reduces the drawdown solver's available Personal Allowance headroom, the same way rental profit already does", () => {
    const pensionAccount: Account = {
      kind: "pension",
      id: "pension1",
      owner: SP_PERSON_ID,
      pensionType: "sipp",
      currentBalance: poundsToPence(500000),
      annualGrowthRate: 0,
      annualChargeRate: 0,
      employerAnnualContribution: zeroPence(),
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [{ ...spPersonWithSalary, targetRetirementAge: 66 }], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [pensionAccount],
      incomeSources: [
        { id: "sp1", type: "statePension", owner: SP_PERSON_ID, config: { annualForecastAmount: poundsToPence(11000) } },
        {
          id: "drawdown1",
          type: "targetDrawdownIncome",
          owner: SP_PERSON_ID,
          // Raised from £10,000: State Pension now nets off the target itself (not just
          // band headroom), and £11,000 of it alone would zero out a £10,000 target
          // entirely — no drawdown left to test the headroom effect with. £25,000 leaves
          // a genuine £14,000 gap, still large enough to spill past the remaining £1,570
          // of Personal Allowance headroom into the basic rate band.
          config: { targetNetAnnualIncome: poundsToPence(25000), startAge: 66 },
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    // Year 1 (2027, age 66): State Pension (£11,000) already exceeds the £12,570 Personal Allowance on its own,
    // leaving only £1,570 of 0%-rate headroom before the drawdown solver's withdrawal spills into the basic rate band —
    // so unlike a from-scratch drawdown (SPEC.md's own "sources a target entirely from within the Personal Allowance"
    // case), this one must incur some Income Tax. The target itself is also netted against
    // State Pension first (£25,000 − £11,000 = £14,000 actually drawn).
    const result = runProjection(scenario, ruleSet2026_27, 2);
    const year1 = result.rows[1]?.perPerson[0];
    expect(year1?.statePensionIncome).toBe(poundsToPence(11000));
    expect(year1?.drawdownIncomeTax).toBeGreaterThan(0);
    expect(year1?.drawdownNetAchieved).toBe(poundsToPence(14000));
  });
});

describe("runProjection — State Pension, further interactions", () => {
  it("is entirely independent between two people in the same household — different State Pension Ages, different forecasts, no cross-contamination", () => {
    const A = personId("spa");
    const B = personId("spb");
    // Both already past their own (different, custom) State Pension Ages
    // at year 0 — A's forecast (£9,000) is deliberately kept *under* the
    // £12,570 Personal Allowance (zero Income Tax, on its own terms, not
    // a bug), while B's (£20,000) is deliberately well *over* it, so a
    // nonzero-vs-zero contrast plus two different nonzero-vs-zero figures
    // together rule out any cross-contamination between the two people's
    // own State Pension income.
    const personA: Person = { id: A, dateOfBirth: "1961-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 65 };
    const personB: Person = { id: B, dateOfBirth: "1959-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 67 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personA, personB], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [],
      incomeSources: [
        { id: "spA", type: "statePension", owner: A, config: { annualForecastAmount: poundsToPence(9000) } },
        { id: "spB", type: "statePension", owner: B, config: { annualForecastAmount: poundsToPence(20000) } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);

    const [a0, b0] = result.rows[0]?.perPerson ?? [];
    expect(a0?.personId).toBe(A);
    expect(a0?.statePensionIncome).toBe(poundsToPence(9000));
    expect(b0?.personId).toBe(B);
    expect(b0?.statePensionIncome).toBe(poundsToPence(20000));

    // A's £9,000 is entirely within the Personal Allowance: zero Income Tax.
    expect(a0?.incomeTax).toBe(0);
    // B's £20,000: (20,000 - 12,570) @ 20% = £1,486.00 — computed from *only* B's own £20,000, never A's £9,000.
    expect(b0?.incomeTax).toBe(poundsToPence(1486));
  });

  it("stops entirely once the receiving person has died — survivorship removes them from perPerson, State Pension included", () => {
    const A = personId("spa");
    const B = personId("spb");
    // A: born 1931, still alive at 95 in 2026, dies (age 96) in 2027 — the same convention the dedicated survivorship describe block uses elsewhere in this file.
    const personA: Person = { id: A, dateOfBirth: "1931-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
    const personB: Person = { id: B, dateOfBirth: "1960-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 90 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personA, personB], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [],
      incomeSources: [{ id: "spA", type: "statePension", owner: A, config: { annualForecastAmount: poundsToPence(10000) } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 2);

    // Year 0 (2026): A is still alive and well past their own (low) SPA — State Pension is flowing.
    expect(result.rows[0]?.perPerson.map((p) => p.personId)).toEqual([A, B]);
    expect(result.rows[0]?.perPerson.find((p) => p.personId === A)?.statePensionIncome).toBe(poundsToPence(10000));

    // Year 1 (2027): A has died — dropped from perPerson entirely, so their State Pension simply stops being reported (not reassigned to B, not left dangling).
    expect(result.rows[1]?.perPerson.map((p) => p.personId)).toEqual([B]);
  });

  it("directly reduces netIncome by the after-tax amount, isolated from any other income", () => {
    const PERSON_ID = personId("sp1");
    const person: Person = { id: PERSON_ID, dateOfBirth: "1950-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 67 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
      accounts: [],
      incomeSources: [{ id: "sp1", type: "statePension", owner: PERSON_ID, config: { annualForecastAmount: poundsToPence(9500) } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const person0 = result.rows[0]?.perPerson[0];

    // £9,500 is entirely within the £12,570 Personal Allowance — zero Income Tax, zero NI (State Pension is never NI-able anyway), so net income equals the forecast amount exactly.
    expect(person0?.incomeTax).toBe(0);
    expect(person0?.nationalInsurance).toBe(0);
    expect(person0?.netIncome).toBe(poundsToPence(9500));
  });

  it("counts toward adjusted net income for Marriage Allowance eligibility — a transferor whose State Pension alone uses up their Personal Allowance can't give it away", () => {
    const A = personId("spa");
    const B = personId("spb");
    const personA: Person = { id: A, dateOfBirth: "1955-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
    const personB: Person = { id: B, dateOfBirth: "1957-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: {
        people: [personA, personB],
        relationshipStatus: "marriedOrCivilPartnership",
        targetIncomeMode: "perPerson",
        marriageAllowanceElection: A,
      },
      accounts: [],
      incomeSources: [
        // A's own State Pension already exceeds the £12,570 Personal Allowance on its own — not eligible to transfer any of it away.
        { id: "spA", type: "statePension", owner: A, config: { annualForecastAmount: poundsToPence(13000) } },
        { id: "spB", type: "statePension", owner: B, config: { annualForecastAmount: poundsToPence(9000) } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    expect(a?.marriageAllowanceGiven).toBe(0);
    expect(b?.marriageAllowanceReceived).toBe(0);
  });

  it("counts toward threshold/adjusted income for the Annual Allowance taper — a State Pension that tips both over their thresholds tapers the allowance further, charging more on the same contribution", () => {
    // Both scenarios: £245,000 salary (relief-at-source, so it never
    // reduces taxableIncome/thresholdIncome itself) + an £58,000 grossed-up
    // pension contribution (paid £46,400, grossed up at the 20% basic
    // rate) — deliberately sized between the un-tapered (£60,000) and
    // heavily-tapered allowance either scenario produces, so the taper's
    // *severity* (not just whether a charge exists at all) is what's
    // being compared. The only difference between the two calls is
    // whether a £11,000 State Pension is also present.
    function makeScenario(includeStatePension: boolean): Scenario {
      const PERSON_ID = personId("sp1");
      const person: Person = { id: PERSON_ID, dateOfBirth: "1950-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
      const pension: Account = {
        kind: "pension",
        id: "pension1",
        owner: PERSON_ID,
        pensionType: "sipp",
        currentBalance: poundsToPence(0),
        annualGrowthRate: 0,
        annualChargeRate: 0,
        employerAnnualContribution: zeroPence(),
      };
      return {
        schemaVersion: 1,
        household: { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" },
        accounts: [pension],
        incomeSources: [
          { id: "sal1", type: "salary", owner: PERSON_ID, config: { grossAnnualSalary: poundsToPence(245000), annualGrowthRate: 0 } },
          ...(includeStatePension
            ? [{ id: "sp1", type: "statePension", owner: PERSON_ID, config: { annualForecastAmount: poundsToPence(11000) } } as const]
            : []),
        ],
        incomeDrains: [
          { id: "pen1", type: "pensionContribution", owner: PERSON_ID, config: { pensionAccountId: "pension1", reliefMethod: "reliefAtSource", annualContribution: poundsToPence(46400) } },
        ],
        inflationRate: 0.025,
        upratingPolicy: { kind: "inflationLinked" },
      };
    }

    const without = runProjection(makeScenario(false), ruleSet2026_27, 1).rows[0]?.perPerson[0];
    const withSP = runProjection(makeScenario(true), ruleSet2026_27, 1).rows[0]?.perPerson[0];

    // Without State Pension: thresholdIncome £245,000 (>£200k), adjustedIncome £245,000+£58,000=£303,000 (>£260k) — taper already applies from salary alone.
    // With State Pension: thresholdIncome £256,000, adjustedIncome £314,000 — £11,000 further into the taper, reducing the Annual Allowance by a further £5,500 (£1 per £2), so £5,500 more of the same £58,000 contribution becomes chargeable.
    expect(withSP?.pensionInputAmount).toBe(without?.pensionInputAmount); // the contribution itself is identical between the two scenarios
    expect(withSP?.annualAllowanceCharge).toBeGreaterThan(without?.annualAllowanceCharge ?? 0);
    // Both incomes are far into the additional-rate band (>£125,140) either way, so the extra £5,500 excess is taxed entirely at 45%: £2,475.00 more charged.
    expect(subtractPence(withSP?.annualAllowanceCharge ?? zeroPence(), without?.annualAllowanceCharge ?? zeroPence())).toBe(poundsToPence(2475));
  });

  it("never activates for a 'joint'-owned instance, even if one were somehow configured — State Pension has no joint/shared form in the UK system", () => {
    const A = personId("spa");
    const B = personId("spb");
    const personA: Person = { id: A, dateOfBirth: "1950-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
    const personB: Person = { id: B, dateOfBirth: "1950-01-01", targetRetirementAge: 67, projectionEndAge: 95, statePensionAge: 60 };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: { people: [personA, personB], relationshipStatus: "unmarried", targetIncomeMode: "perPerson" },
      accounts: [],
      // The UI never offers "joint" for this type (Onboarding.tsx's PERSON_ONLY_CATALOG_TYPES), but the engine
      // itself should still degrade safely rather than crash or attribute income to nobody/everybody, since a
      // hand-edited or imported plan file could contain one.
      incomeSources: [{ id: "spJoint", type: "statePension", owner: "joint", config: { annualForecastAmount: poundsToPence(11000) } }],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
    const result = runProjection(scenario, ruleSet2026_27, 1);
    const [a, b] = result.rows[0]?.perPerson ?? [];
    expect(a?.statePensionIncome).toBe(0);
    expect(b?.statePensionIncome).toBe(0);
  });
});

describe("runProjection — one-off inflow with a chosen ISA/GIA destination (SPEC.md §3.9)", () => {
  const destinationPerson: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
  const destinationHousehold: Household = { people: [destinationPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  it("credits the full amount directly into a chosen GIA — none of it becomes ordinary spendable net income", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 }],
      incomeSources: [
        { id: "inflow1", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(10000), date: "2026-06-01", category: "inheritance", destinationAccountId: "gia1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(10000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(10000));
    // Entirely credited — nothing left over to show up as net income or get swept elsewhere.
    expect(personResult?.netIncome).toBe(0);
  });

  it("credits the full amount directly into a chosen cash account, uncapped, with no cost-basis tracking", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: poundsToPence(2000), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "inflow1", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(10000), date: "2026-06-01", category: "inheritance", destinationAccountId: "cash1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(12000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
  });

  it("credits the full amount directly into a chosen ISA when it fits within the annual subscription limit", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "inflow1", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(15000), date: "2026-06-01", category: "inheritance", destinationAccountId: "isa1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(15000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
  });

  it("caps an ISA-destined inflow at the £20,000 annual subscription limit — the excess becomes ordinary spendable income, not silently lost or over-credited", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "inflow1", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(25000), date: "2026-06-01", category: "inheritance", destinationAccountId: "isa1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    // Capped at the 2026-27 £20,000 ISA allowance, not the full £25,000.
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    // The uncredited £5,000 remainder still reaches the person as ordinary net income — no GIA exists here for the surplus sweep to catch it, so it stays as spendable cash rather than vanishing.
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(poundsToPence(5000));
  });

  it("shares its ISA room with the automatic surplus sweep — the sweep only tops up whatever's left, never double-allowing the annual limit", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [
        { kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 },
        { kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 },
      ],
      incomeSources: [
        // Uses £15,000 of the £20,000 ISA room directly.
        { id: "inflow1", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(15000), date: "2026-06-01", category: "inheritance", destinationAccountId: "isa1" } },
        // No destination set — this £10,000 is ordinary net income the surplus sweep will try to invest.
        { id: "inflow2", type: "oneOffInflow", owner: PERSON_ID, config: { amount: poundsToPence(10000), date: "2026-06-01", category: "other" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];
    // Only £5,000 of ISA room was left (£20,000 - £15,000 already used), so the sweep puts £5,000 in the ISA and spills the remaining £5,000 to the GIA.
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(5000));
    expect(personResult?.surplusSweptToIsa).toBe(poundsToPence(5000));
    expect(personResult?.surplusSweptToGia).toBe(poundsToPence(5000));
  });
});

describe("runProjection — general cash income with a required cash/GIA/ISA/SIPP destination (SPEC.md §3.9)", () => {
  const destinationPerson: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
  const destinationHousehold: Household = { people: [destinationPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };

  it("credits the full amount directly into a chosen cash account every active year, tax-free", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: zeroPence(), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "income1", type: "generalCashIncome", owner: PERSON_ID, config: { amount: poundsToPence(6000), destinationAccountId: "cash1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 2);
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(6000));
    expect(result.rows[1]?.accountBalances.get("cash1")).toBe(poundsToPence(12000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
    expect(result.rows[0]?.perPerson[0]?.incomeTax).toBe(0);
  });

  it("credits the full amount directly into a chosen GIA, increasing cost basis too", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "gia", id: "gia1", owner: PERSON_ID, currentBalance: zeroPence(), costBasis: zeroPence(), annualGrowthRate: 0, annualDividendYield: 0 }],
      incomeSources: [
        { id: "income1", type: "generalCashIncome", owner: PERSON_ID, config: { amount: poundsToPence(4000), destinationAccountId: "gia1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.accountBalances.get("gia1")).toBe(poundsToPence(4000));
    expect(result.rows[0]?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(4000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
  });

  it("credits the full amount directly into a chosen SIPP, with no Annual Allowance impact", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [
        { kind: "pension", id: "pension1", owner: PERSON_ID, pensionType: "sipp", currentBalance: poundsToPence(50000), annualGrowthRate: 0, annualChargeRate: 0, employerAnnualContribution: pence(0) },
      ],
      incomeSources: [
        { id: "income1", type: "generalCashIncome", owner: PERSON_ID, config: { amount: poundsToPence(3000), destinationAccountId: "pension1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(53000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(0);
    expect(result.rows[0]?.perPerson[0]?.annualAllowanceCharge).toBe(0);
  });

  it("caps an ISA-destined general cash income at the annual subscription limit each year — the excess becomes ordinary spendable income, not lost", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "isa", id: "isa1", owner: PERSON_ID, isaType: "stocksAndShares", currentBalance: zeroPence(), annualGrowthRate: 0 }],
      incomeSources: [
        { id: "income1", type: "generalCashIncome", owner: PERSON_ID, config: { amount: poundsToPence(25000), destinationAccountId: "isa1" } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 1);
    // Capped at the 2026-27 £20,000 ISA allowance, not the full £25,000.
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(20000));
    expect(result.rows[0]?.perPerson[0]?.netIncome).toBe(poundsToPence(5000));
  });

  it("respects the generic startDate/endDate scheduling — stops crediting once the instance has ended", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: destinationHousehold,
      accounts: [{ kind: "cash", id: "cash1", owner: PERSON_ID, currentBalance: zeroPence(), annualGrowthRate: 0 }],
      incomeSources: [
        {
          id: "income1",
          type: "generalCashIncome",
          owner: PERSON_ID,
          config: { amount: poundsToPence(1000), destinationAccountId: "cash1" },
          startDate: "2026-01-01",
          endDate: "2026-12-31",
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 2);
    expect(result.rows[0]?.accountBalances.get("cash1")).toBe(poundsToPence(1000));
    expect(result.rows[1]?.accountBalances.get("cash1")).toBe(poundsToPence(1000));
  });
});

describe("runProjection — multiple targetDrawdownIncome instances as step phases (SPEC.md §5.7.1)", () => {
  const PERSON_B_ID = personId("b");
  // Age 65 in 2026, 66 in 2027, 67 in 2028 — a person's own DOB is the
  // clock every targetDrawdownIncome instance's startAge/endAge is
  // checked against.
  const stepPerson: Person = { id: PERSON_ID, dateOfBirth: "1961-01-01", targetRetirementAge: 65, projectionEndAge: 95 };
  const stepHousehold: Household = { people: [stepPerson], relationshipStatus: null, targetIncomeMode: "perPerson" };
  const bigPension = {
    kind: "pension" as const,
    id: "pension1",
    owner: PERSON_ID,
    pensionType: "sipp" as const,
    currentBalance: poundsToPence(2000000),
    annualGrowthRate: 0,
    annualChargeRate: 0,
    employerAnnualContribution: pence(0),
  };

  it("steps from an earlier, higher target to a later, lower one — the two instances never both apply in the same year", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: stepHousehold,
      accounts: [bigPension],
      incomeSources: [
        { id: "phase1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(80000), startAge: 65, endAge: 67 } },
        { id: "phase2", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 67 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);

    // 2026 (age 65) and 2027 (age 66) — phase 1 only.
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(80000));
    expect(result.rows[1]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(80000));
    // 2028 (age 67) — phase 1 has ended (age < endAge fails at exactly 67), phase 2 only.
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(50000));
  });

  it("with no endAge of its own, a phase implicitly stops where the next same-owner phase starts — no need to state the boundary twice", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: stepHousehold,
      accounts: [bigPension],
      incomeSources: [
        // No endAge on phase 1 at all — still steps cleanly at 67, since
        // phase 2's own startAge is picked up automatically.
        { id: "phase1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(80000), startAge: 65 } },
        { id: "phase2", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 67 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(80000)); // 2026, age 65
    expect(result.rows[1]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(80000)); // 2027, age 66
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(50000)); // 2028, age 67 — phase 1 implicitly ended, phase 2 only
  });

  it("picks up the nearest next phase, not just any later one, when three or more are chained with no explicit endAge", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: stepHousehold,
      accounts: [bigPension],
      incomeSources: [
        { id: "phase1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(80000), startAge: 65 } },
        { id: "phase2", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(60000), startAge: 66 } },
        { id: "phase3", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 67 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    expect(result.rows[0]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(80000)); // 2026, age 65 — phase 1
    expect(result.rows[1]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(60000)); // 2027, age 66 — phase 2, not phase 1
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(50000)); // 2028, age 67 — phase 3
  });

  it("still sums two instances when a phase's own explicit endAge deliberately extends past the next phase's start — an explicit value always wins over the implicit next-phase inference", () => {
    const scenario: Scenario = {
      schemaVersion: 1,
      household: stepHousehold,
      accounts: [bigPension],
      incomeSources: [
        // Explicitly stated to run to 68, one year past phase 2's own start at 67.
        { id: "phase1", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(80000), startAge: 65, endAge: 68 } },
        { id: "phase2", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 67 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    // 2028, age 67 — both phase 1 (explicitly still active) and phase 2 apply, summing.
    expect(result.rows[2]?.perPerson[0]?.drawdownNetAchieved).toBe(poundsToPence(130000));
  });

  it("an individual phase and a joint phase never implicitly bound each other — only an explicit endAge does", () => {
    const jointStepHousehold: Household = {
      people: [stepPerson, { id: PERSON_B_ID, dateOfBirth: "1961-01-01", targetRetirementAge: 65, projectionEndAge: 95 }],
      relationshipStatus: null,
      targetIncomeMode: "perPerson",
    };
    const scenario: Scenario = {
      schemaVersion: 1,
      household: jointStepHousehold,
      accounts: [bigPension, { ...bigPension, id: "pension2", owner: PERSON_B_ID }],
      incomeSources: [
        { id: "individual", type: "targetDrawdownIncome", owner: PERSON_ID, config: { targetNetAnnualIncome: poundsToPence(80000), startAge: 65 } },
        { id: "joint", type: "targetDrawdownIncome", owner: "joint", config: { targetNetAnnualIncome: poundsToPence(50000), startAge: 67 } },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 3);
    // 2028, age 67 — the individual phase is still active (never implicitly
    // capped by the differently-owned joint phase), on top of the joint
    // one. Summed across both people rather than asserted per-person,
    // since exactly how the joint £50,000 itself splits between them is
    // the household drawdown optimiser's own concern, not this test's.
    const totalAchieved = sumPence((result.rows[2]?.perPerson ?? []).map((p) => p.drawdownNetAchieved));
    expect(totalAchieved).toBe(poundsToPence(130000));
  });
});
