import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../money/pence.js";
import { personId, type Household, type Person, type Scenario } from "../schema/types.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { runProjection } from "./runProjection.js";

// Side-effect imports: registers every Phase 1 catalog type with the
// shared registry (SPEC.md §9.4) — this is what a future
// catalog/incomeSources/index.ts and catalog/incomeDrains/index.ts will
// do more completely as more types are added.
import "../catalog/incomeSources/salary.js";
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
