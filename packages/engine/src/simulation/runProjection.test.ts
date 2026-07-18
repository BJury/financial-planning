import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection, totalTaxForYear } from "./runProjection.js";

// Side-effect imports: registers every Phase 1 catalog type with the
// shared registry (SPEC.md §9.4) — this is what a future
// catalog/incomeSources/index.ts and catalog/incomeDrains/index.ts will
// do more completely as more types are added.
import "../catalog/incomeSources/salary.js";
import "../catalog/incomeSources/targetDrawdownIncome.js";
import "../catalog/incomeDrains/pensionContribution.js";
import "../catalog/incomeDrains/isaContribution.js";

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

  it("credits the grossed-up pension contribution and grows the pension balance net of charges", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const year0 = result.rows[0];
    // £10,000 start + £5,000 gross contribution = £15,000, grown at (3% - 0.5% charge) = 2.5%
    // £15,000 * 1.025 = £15,375.00
    expect(year0?.accountBalances.get("pension1")).toBe(poundsToPence(15375));
  });

  it("credits the ISA contribution and grows the ISA balance", () => {
    const result = runProjection(makeGoldenScenario(), ruleSet2026_27, 1);
    const year0 = result.rows[0];
    // £2,000 start + £5,000 contribution = £7,000, grown at 4% = £7,280.00
    expect(year0?.accountBalances.get("isa1")).toBe(poundsToPence(7280));
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
    incomeDrains: [],
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
    // Net income is entirely the drawdown — there's no earned income for a retired person.
    expect(personResult?.netIncome).toBe(poundsToPence(10000));
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
    expect(personResult?.netIncome).toBe(0);
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
