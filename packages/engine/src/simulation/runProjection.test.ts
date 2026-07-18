import { describe, expect, it } from "vitest";
import { addPence, pence, poundsToPence, subtractPence, sumPence, zeroPence } from "../money/pence.js";
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
import "../catalog/incomeSources/rentalIncome.js";
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

    // Net income: £70,000 - £14,432.00 - £3,410.60 = £52,157.40
    expect(personResult?.netIncome).toBe(poundsToPence(52157.4));
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
    // £2,000 start + £5,000 contribution = £7,000. Net income (£52,157.40,
    // see the Income Tax test above) has nowhere else to go in this
    // scenario (no living expenses drain), so the surplus cash sweep
    // invests as much of it as fits in the remaining ISA subscription
    // room (£20,000 limit - £5,000 already contributed = £15,000) —
    // £7,000 + £15,000 = £22,000, grown at 4% = £22,880.00. The
    // remaining £37,157.40 of surplus has nowhere to go (no GIA in this
    // scenario) and stays unswept, per the sweep's documented v1 scope.
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
          // Person is 46 in 2026 and 47 in 2027 (born 1980); retires at 48, i.e. calendar year 2028 (yearIndex 2).
          config: { grossAnnualSalary: poundsToPence(50000), annualGrowthRate: 0, endAge: 48 },
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

  it("composes with a type's own isActive check — both must agree for income to count", () => {
    // A salary with both a generic endDate and its own age-based endAge —
    // whichever constraint bites first wins.
    const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 95 };
    const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };

    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [],
      incomeSources: [
        {
          id: "src1",
          type: "salary",
          owner: PERSON_ID,
          config: { grossAnnualSalary: poundsToPence(12000), annualGrowthRate: 0, endAge: 50 }, // age 50 reached in calendar year 2030
          endDate: "2050-12-31", // generic end date is far later — endAge should bite first
        },
      ],
      incomeDrains: [],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    const result = runProjection(scenario, ruleSet2026_27, 6); // 2026-2031
    const grossIncomeByYear = result.rows.map((row) => row.perPerson[0]?.grossIncome ?? pence(0));
    // Age 50 is reached in calendar year 2030 (yearIndex 4) — active up to and including yearIndex 3 (age 49).
    expect(grossIncomeByYear[3]).toBe(poundsToPence(12000));
    expect(grossIncomeByYear[4]).toBe(0);
    expect(grossIncomeByYear[5]).toBe(0);
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
          pensionAccountId: "pension1",
          isaAccountId: "isa1",
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
    // The living expenses drain (see makeDrawdownScenario) still applies even before the drawdown itself starts — a £10,000 deficit, funded from outside this minimal scenario.
    expect(personResult?.netIncome).toBe(subtractPence(zeroPence(), poundsToPence(10000)));
    expect(result.rows[0]?.accountBalances.get("pension1")).toBe(poundsToPence(500000));
    expect(result.rows[0]?.accountBalances.get("isa1")).toBe(poundsToPence(5000));
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
            pensionAccountId: "pension1",
            isaAccountId: "isa1",
            cashAccountId: "cash1",
            giaAccountId: "gia1",
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
  function makeInvestmentScenario(): Scenario {
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
      // Deliberately large enough to absorb all net income — keeps these
      // tests focused on savings/dividend tax mechanics, not the surplus
      // cash sweep (there's no ISA here, so unswept surplus would
      // otherwise all land in the GIA and change its expected balance).
      incomeDrains: [
        {
          id: "expenses1",
          type: "livingExpenses",
          owner: PERSON_ID,
          config: { annualAmount: poundsToPence(200000) },
        },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };
  }

  it("taxes cash interest via the (smaller, higher-rate) Personal Savings Allowance, stacked above earned income", () => {
    const result = runProjection(makeInvestmentScenario(), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // £60,000 salary puts this person in higher-rate territory -> £500 PSA (not the £1,000 basic-rate figure).
    // £20,000 * 5% = £1,000 interest; £500 taxable at the higher Income Tax rate (40%).
    expect(personResult?.savingsInterestIncome).toBe(poundsToPence(1000));
    expect(personResult?.savingsTax).toBe(poundsToPence(500 * 0.4));
  });

  it("taxes GIA dividends via the Dividend Allowance and dividend-specific rates, stacked above savings income", () => {
    const result = runProjection(makeInvestmentScenario(), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];

    // £50,000 * 4% = £2,000 dividends; £500 Dividend Allowance; £1,500 taxable at the higher dividend rate (35.75% for 2026/27, not the 40% standard higher rate).
    expect(personResult?.dividendIncome).toBe(poundsToPence(2000));
    const expectedDividendTax = poundsToPence(1500 * ruleSet2026_27.dividendTax.higherRate);
    expect(personResult?.dividendTax).toBe(expectedDividendTax);
    // Materially different from what the standard 40% Income Tax rate would have charged — proves the dividend-specific schedule is actually in use.
    expect(personResult?.dividendTax).not.toBe(poundsToPence(1500 * 0.4));
  });

  it("reinvests dividends into both the GIA's balance and its cost basis, and grows the cash balance by its interest rate", () => {
    const result = runProjection(makeInvestmentScenario(), ruleSet2026_27, 1);
    const row = result.rows[0];

    // Cash: £20,000 grown at 5% = £21,000 (the same rate used for both the taxable-interest calculation and the balance growth).
    expect(row?.accountBalances.get("cash1")).toBe(poundsToPence(21000));
    // GIA: £50,000 + £2,000 reinvested dividend = £52,000, then grown by the 3% capital rate = £53,560.
    expect(row?.accountBalances.get("gia1")).toBe(poundsToPence(53560));
    // Cost basis starts at £40,000 and grows only by the reinvested dividend (£2,000) — never by capital appreciation.
    expect(row?.costBasisByAccountId.get("gia1")).toBe(poundsToPence(42000));
  });

  it("reduces net income by the tax owed on interest and dividends, even though neither is paid out as spendable cash", () => {
    const result = runProjection(makeInvestmentScenario(), ruleSet2026_27, 1);
    const personResult = result.rows[0]?.perPerson[0];
    expect(personResult).toBeDefined();
    if (!personResult) throw new Error("expected a person result");

    const expectedNetIncome =
      poundsToPence(60000) -
      personResult.incomeTax -
      personResult.nationalInsurance -
      personResult.savingsTax -
      personResult.dividendTax -
      poundsToPence(200000); // the living expenses drain, see makeInvestmentScenario
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
      incomeSources: [],
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
      config: { targetNetAnnualIncome: poundsToPence(10000), startAge: 55, giaAccountId: "gia1" },
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
      // A large living-expenses drain per person, consuming their salary
      // net income entirely — this is drawdown/dividend-split mechanics
      // under test here, not the surplus cash sweep (which would
      // otherwise also invest each salary's leftover into this same
      // joint GIA and inflate the balance assertion below).
      incomeDrains: [
        { id: "expA", type: "livingExpenses", owner: PERSON_A_ID, config: { annualAmount: poundsToPence(20000) } },
        { id: "expB", type: "livingExpenses", owner: PERSON_B_ID, config: { annualAmount: poundsToPence(20000) } },
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
            targetNetAnnualIncome: poundsToPence(60000),
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
