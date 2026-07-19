import { describe, expect, it } from "vitest";
import { addPence, poundsToPence, zeroPence } from "../money/pence.js";
import { personId } from "../schema/types.js";
import { buildFullBandStack, computeRemainingBandHeadroom } from "../tax/incomeTax.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { solveHouseholdDrawdown, type HouseholdDrawdownPerson } from "./solveHouseholdDrawdown.js";

const standardBands = ruleSet2026_27.incomeTaxEngland.bands.map((b) => ({
  name: b.name,
  upTo: b.upTo === null ? null : poundsToPence(b.upTo),
  rate: b.rate,
}));
const fullAllowance = poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowance);
const fullBands = buildFullBandStack(fullAllowance, standardBands);
const ampleLsa = poundsToPence(ruleSet2026_27.pensions.lumpSumAllowance);
const ampleAea = poundsToPence(ruleSet2026_27.capitalGainsTax.annualExemptAmount);
const cgtRates = { basicRate: ruleSet2026_27.capitalGainsTax.basicRate, higherRate: ruleSet2026_27.capitalGainsTax.higherRate };

const PERSON_A = personId("a");
const PERSON_B = personId("b");

/** A person with no other income this year, ample pension/LSA, no ISA/cash/GIA. */
function generousPension(): HouseholdDrawdownPerson<typeof PERSON_A>["state"] {
  return {
    bandHeadroom: computeRemainingBandHeadroom(fullBands, zeroPence()),
    pensionBalance: poundsToPence(500000),
    lumpSumAllowanceRemaining: ampleLsa,
    isaBalance: zeroPence(),
    cashBalance: zeroPence(),
    giaBalance: zeroPence(),
    giaCostBasis: zeroPence(),
    capitalGainsExemptAmountRemaining: ampleAea,
  };
}

/** A person already deep into the higher-rate band from other income (e.g. still working), same generous pension otherwise. */
function alreadyHigherRate(): HouseholdDrawdownPerson<typeof PERSON_A>["state"] {
  return {
    ...generousPension(),
    bandHeadroom: computeRemainingBandHeadroom(fullBands, poundsToPence(80000)),
  };
}

/** A person with both ample pension and ample ISA — for tests of the taxable/non-taxable preference, which need genuine capacity on both sides. */
function generousEverything(): HouseholdDrawdownPerson<typeof PERSON_A>["state"] {
  return { ...generousPension(), isaBalance: poundsToPence(50000) };
}

describe("solveHouseholdDrawdown", () => {
  it("delegates straight to solveDrawdown for a single-person household", () => {
    const target = poundsToPence(10000);
    const result = solveHouseholdDrawdown(target, { kind: "optimised" }, [{ id: PERSON_A, state: generousPension() }], cgtRates);
    expect(result.perPerson).toHaveLength(1);
    expect(result.perPerson[0]?.id).toBe(PERSON_A);
    expect(result.totalNetAchieved).toBe(target);
    expect(result.totalTaxCost).toBe(0); // entirely within PA via UFPLS
  });

  it("reports a shortfall (target unmet) with no people at all", () => {
    const result = solveHouseholdDrawdown(poundsToPence(10000), { kind: "optimised" }, [], cgtRates);
    expect(result.perPerson).toEqual([]);
    expect(result.totalNetAchieved).toBe(0);
    expect(result.shortfall).toBe(true);
  });

  describe("'even' strategy", () => {
    it("splits the target exactly in half between two identical people", () => {
      const target = poundsToPence(20000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "even" },
        [
          { id: PERSON_A, state: generousPension() },
          { id: PERSON_B, state: generousPension() },
        ],
        cgtRates,
      );
      const a = result.perPerson.find((p) => p.id === PERSON_A);
      const b = result.perPerson.find((p) => p.id === PERSON_B);
      expect(a?.result.netAchieved).toBe(poundsToPence(10000));
      expect(b?.result.netAchieved).toBe(poundsToPence(10000));
      expect(result.totalNetAchieved).toBe(target);
    });

    it("gives the exact remainder penny to the second person for an odd amount, so the two targets still sum exactly", () => {
      const target = poundsToPence(10000.01);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "even" },
        [
          { id: PERSON_A, state: generousPension() },
          { id: PERSON_B, state: generousPension() },
        ],
        cgtRates,
      );
      expect(result.totalNetAchieved).toBe(target);
    });
  });

  describe("'custom' strategy", () => {
    it("splits the target by the given share", () => {
      const target = poundsToPence(10000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "custom", firstPersonShare: 0.7 },
        [
          { id: PERSON_A, state: generousPension() },
          { id: PERSON_B, state: generousPension() },
        ],
        cgtRates,
      );
      const a = result.perPerson.find((p) => p.id === PERSON_A);
      const b = result.perPerson.find((p) => p.id === PERSON_B);
      expect(a?.result.netAchieved).toBe(poundsToPence(7000));
      expect(b?.result.netAchieved).toBe(poundsToPence(3000));
    });
  });

  describe("'optimised' strategy", () => {
    it("achieves the target entirely tax-free when both people's combined free capacity covers it", () => {
      const target = poundsToPence(15000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "optimised" },
        [
          { id: PERSON_A, state: generousPension() },
          { id: PERSON_B, state: generousPension() },
        ],
        cgtRates,
      );
      expect(result.totalNetAchieved).toBe(target);
      expect(result.totalTaxCost).toBe(0);
      expect(result.shortfall).toBe(false);
    });

    it("prefers the person with unused Personal Allowance headroom over one already in the higher-rate band, achieving strictly lower total tax than an even split", () => {
      // A target large enough that it can't be met tax-free by either person alone,
      // so the choice of *who* draws the taxed remainder actually matters.
      const target = poundsToPence(60000);
      const peopleForOptimised = [
        { id: PERSON_A, state: generousPension() }, // no other income — lots of cheap headroom
        { id: PERSON_B, state: alreadyHigherRate() }, // £80,000 of other income already
      ] as const;

      const optimised = solveHouseholdDrawdown(target, { kind: "optimised" }, peopleForOptimised, cgtRates);
      const even = solveHouseholdDrawdown(target, { kind: "even" }, peopleForOptimised, cgtRates);

      expect(optimised.totalNetAchieved).toBe(target);
      expect(optimised.shortfall).toBe(false);
      // The optimised split routes more of the taxed remainder through
      // Person A's cheaper headroom instead of splitting evenly into
      // Person B's already-higher-rate band — strictly cheaper overall.
      expect(optimised.totalTaxCost).toBeLessThan(even.totalTaxCost);

      const optimisedA = optimised.perPerson.find((p) => p.id === PERSON_A)?.result.netAchieved ?? zeroPence();
      const optimisedB = optimised.perPerson.find((p) => p.id === PERSON_B)?.result.netAchieved ?? zeroPence();
      expect(optimisedA).toBeGreaterThan(optimisedB);
    });

    it("spills over to the second person once the cheaper person's own capacity is exhausted", () => {
      const smallPot: HouseholdDrawdownPerson<typeof PERSON_A>["state"] = {
        ...generousPension(),
        pensionBalance: poundsToPence(5000), // not enough to cover the target alone
      };
      const target = poundsToPence(30000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "optimised" },
        [
          { id: PERSON_A, state: smallPot },
          { id: PERSON_B, state: generousPension() },
        ],
        cgtRates,
      );
      expect(result.shortfall).toBe(false);
      expect(result.totalNetAchieved).toBe(target);
      const b = result.perPerson.find((p) => p.id === PERSON_B);
      expect(b?.result.netAchieved).toBeGreaterThan(0); // picked up the remainder A couldn't cover
    });

    it("reports a genuine shortfall once both people's combined capacity is exhausted", () => {
      const smallPot: HouseholdDrawdownPerson<typeof PERSON_A>["state"] = { ...generousPension(), pensionBalance: poundsToPence(1000) };
      const result = solveHouseholdDrawdown(
        poundsToPence(1000000),
        { kind: "optimised" },
        [
          { id: PERSON_A, state: smallPot },
          { id: PERSON_B, state: smallPot },
        ],
        cgtRates,
      );
      expect(result.shortfall).toBe(true);
      expect(result.totalNetAchieved).toBeLessThan(poundsToPence(1000000));
    });

    it("keeps every person's own bucket totals internally consistent with the combined totals", () => {
      const target = poundsToPence(60000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "optimised" },
        [
          { id: PERSON_A, state: generousPension() },
          { id: PERSON_B, state: alreadyHigherRate() },
        ],
        cgtRates,
      );
      const sumOfPersonNet = result.perPerson.reduce((total, p) => addPence(total, p.result.netAchieved), zeroPence());
      const sumOfPersonTax = result.perPerson.reduce(
        (total, p) => addPence(total, addPence(p.result.incomeTaxCost, p.result.capitalGainsTaxCost)),
        zeroPence(),
      );
      expect(sumOfPersonNet).toBe(result.totalNetAchieved);
      expect(sumOfPersonTax).toBe(result.totalTaxCost);
    });
  });

  describe("taxable/non-taxable preference (taxablePreferenceAmount)", () => {
    it("splits the household's one combined preference proportionally, by the same share used for the target itself ('even' strategy)", () => {
      const target = poundsToPence(20000);
      const result = solveHouseholdDrawdown(
        target,
        { kind: "even" },
        [
          { id: PERSON_A, state: generousEverything() },
          { id: PERSON_B, state: generousEverything() },
        ],
        cgtRates,
        poundsToPence(8000), // household preference — each person's own £10,000 target gets a £4,000 preferred pension share
      );
      const a = result.perPerson.find((p) => p.id === PERSON_A)?.result;
      const b = result.perPerson.find((p) => p.id === PERSON_B)?.result;

      expect(a?.pensionGrossWithdrawn).toBe(poundsToPence(4000));
      expect(a?.isaGrossWithdrawn).toBe(poundsToPence(6000));
      expect(b?.pensionGrossWithdrawn).toBe(poundsToPence(4000));
      expect(b?.isaGrossWithdrawn).toBe(poundsToPence(6000));
      expect(result.totalNetAchieved).toBe(target);
    });

    it("leaves every existing call untouched when no preference is passed at all", () => {
      const target = poundsToPence(20000);
      const withoutPreferenceArg = solveHouseholdDrawdown(
        target,
        { kind: "even" },
        [
          { id: PERSON_A, state: generousEverything() },
          { id: PERSON_B, state: generousEverything() },
        ],
        cgtRates,
      );
      const a = withoutPreferenceArg.perPerson.find((p) => p.id === PERSON_A)?.result;
      // No preference at all — the default tax-optimised order applies: pension fills the
      // Personal Allowance first (£12,570 worth, well within the £10,000 target), so the whole
      // £10,000 comes from pension and the ISA is never touched.
      expect(a?.pensionGrossWithdrawn).toBe(poundsToPence(10000));
      expect(a?.isaGrossWithdrawn).toBe(0);
    });

    it("shifts more of the draw toward ISA under the 'optimised' strategy when the preference favours non-taxable sources", () => {
      const target = poundsToPence(60000);
      const people = [
        { id: PERSON_A, state: generousEverything() },
        { id: PERSON_B, state: { ...alreadyHigherRate(), isaBalance: poundsToPence(50000) } },
      ] as const;

      const taxOptimised = solveHouseholdDrawdown(target, { kind: "optimised" }, people, cgtRates);
      // A low preference (£5,000 of the £60,000 household target) steers most of the rest toward ISA/cash/GIA.
      const preferred = solveHouseholdDrawdown(target, { kind: "optimised" }, people, cgtRates, poundsToPence(5000));

      const totalIsa = (result: typeof taxOptimised) => result.perPerson.reduce((total, p) => addPence(total, p.result.isaGrossWithdrawn), zeroPence());
      expect(totalIsa(preferred)).toBeGreaterThan(totalIsa(taxOptimised));
      expect(preferred.totalNetAchieved).toBe(target);
      expect(preferred.shortfall).toBe(false);
    });
  });
});
