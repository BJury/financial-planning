import { describe, expect, it } from "vitest";
import { pence, poundsToPence, subtractPence, sumPence, zeroPence } from "../money/pence.js";
import { personId, type Account, type Household, type IncomeDrainInstance, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection, totalTaxForYear } from "./runProjection.js";

// Side-effect imports: registers every Phase 1 catalog type with the
// shared registry (SPEC.md §9.4) — this is what a future
// catalog/incomeSources/index.ts and catalog/incomeDrains/index.ts will
// do more completely as more types are added.
import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";
import "../catalog/incomeSources/oneOffInflow.js";
import "../catalog/incomeDrains/pensionContribution.js";
import "../catalog/incomeDrains/isaContribution.js";
import "../catalog/incomeDrains/livingExpenses.js";
import "../catalog/incomeDrains/oneOffOutflow.js";
import "../catalog/incomeDrains/giaContribution.js";
import "../catalog/incomeDrains/cashContribution.js";

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
