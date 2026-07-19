import { describe, expect, it } from "vitest";
import { pence, poundsToPence, sumPence, zeroPence } from "../money/pence.js";
import { buildFullBandStack, computeRemainingBandHeadroom } from "../tax/incomeTax.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import { solveDrawdown, type DrawdownSolverInputs } from "./solveDrawdown.js";

const standardBands = ruleSet2026_27.incomeTaxEngland.bands.map((b) => ({
  name: b.name,
  upTo: b.upTo === null ? null : poundsToPence(b.upTo),
  rate: b.rate,
}));
const fullAllowance = poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowance);
const fullBands = buildFullBandStack(fullAllowance, standardBands);

/** Band headroom with no other income already earned this year — the common case for a fully-retired person. */
function headroomWithNoOtherIncome() {
  return computeRemainingBandHeadroom(fullBands, zeroPence());
}

const ampleLsa = poundsToPence(ruleSet2026_27.pensions.lumpSumAllowance);
const ampleAea = poundsToPence(ruleSet2026_27.capitalGainsTax.annualExemptAmount);
const cgtRates = { basicRate: ruleSet2026_27.capitalGainsTax.basicRate, higherRate: ruleSet2026_27.capitalGainsTax.higherRate };

/** No GIA or cash account — spread into inputs for tests that only care about pension/ISA behaviour. */
const noGiaOrCash = {
  cashBalance: zeroPence(),
  giaBalance: zeroPence(),
  giaCostBasis: zeroPence(),
  capitalGainsExemptAmountRemaining: ampleAea,
  capitalGainsRates: cgtRates,
};

function bucketAmount(result: ReturnType<typeof solveDrawdown>, bucket: string) {
  return result.buckets.find((b) => b.bucket === bucket)?.amount ?? 0;
}

describe("solveDrawdown", () => {
  it("sources a target entirely from within the Personal Allowance via UFPLS, with no ISA touched", () => {
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(10000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    // £10,000 net at 0% marginal rate: gross = net (PA rate is 0%).
    expect(bucketAmount(result, "taxFreePensionLumpSum")).toBe(poundsToPence(2500)); // 25% of £10,000
    expect(bucketAmount(result, "taxablePersonalAllowance")).toBe(poundsToPence(7500)); // 75% of £10,000
    expect(result.incomeTaxCost).toBe(0);
    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(10000));
    expect(result.isaGrossWithdrawn).toBe(0); // ISA left untouched — PA-band pension is preferred (SPEC.md §5.7.3)
    expect(result.netAchieved).toBe(poundsToPence(10000));
    expect(result.shortfall).toBe(false);
  });

  it("spills into the ISA once the Personal Allowance band is exhausted", () => {
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(20000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    // The whole £12,570 Personal Allowance is used via pension (gross = £12,570 / 0.75 = £16,760, at 0% cost).
    const paGross = poundsToPence(Math.round((12570 / 0.75) * 100) / 100);
    expect(result.pensionGrossWithdrawn).toBe(paGross);
    expect(bucketAmount(result, "taxablePersonalAllowance")).toBe(fullAllowance);
    // The £3,240 shortfall (£20,000 - £16,760) comes from the ISA.
    expect(bucketAmount(result, "taxFreeISA")).toBe(pence(poundsToPence(20000) - paGross));
    expect(result.isaGrossWithdrawn).toBe(pence(poundsToPence(20000) - paGross));
    expect(result.incomeTaxCost).toBe(0);
    expect(result.netAchieved).toBe(poundsToPence(20000));
    expect(result.shortfall).toBe(false);
  });

  it("switches to a fully-taxable withdrawal, still within the same band, once the Lump Sum Allowance runs out mid-band", () => {
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(12670), // exactly fills the £12,570 PA band (see hand calc below)
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: poundsToPence(100), // covers only £400 gross (100 * 4) via UFPLS
      isaBalance: poundsToPence(0),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    // Sub-step A: £400 gross via UFPLS -> £100 tax-free + £300 taxable (both at 0% since PA covers it).
    // Sub-step B: the remaining £12,270 of PA headroom (£12,570 - £300) is fully taxable, still at 0%.
    expect(bucketAmount(result, "taxFreePensionLumpSum")).toBe(poundsToPence(100));
    expect(bucketAmount(result, "taxablePersonalAllowance")).toBe(fullAllowance);
    expect(result.lumpSumAllowanceUsed).toBe(poundsToPence(100));
    expect(result.incomeTaxCost).toBe(0);
    expect(result.netAchieved).toBe(poundsToPence(12670));
    expect(result.shortfall).toBe(false);
  });

  it("escalates into the basic rate band once the Personal Allowance and ISA are both exhausted", () => {
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(50000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    expect(bucketAmount(result, "taxableBasicRate")).toBeGreaterThan(0);
    // Basic rate tax was actually charged.
    expect(result.incomeTaxCost).toBeGreaterThan(0);
    // The net achieved should still (approximately, to the nearest few pence of rounding) equal the target.
    expect(Math.abs(result.netAchieved - poundsToPence(50000))).toBeLessThanOrEqual(5);
    expect(result.shortfall).toBe(false);
  });

  it("draws entirely from the unbounded additional-rate band when other income has already used up every finite band", () => {
    // Other income (e.g. a very large salary) has already consumed the PA, basic, and higher bands entirely.
    const headroom = computeRemainingBandHeadroom(fullBands, poundsToPence(200000));
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(10000),
      bandHeadroom: headroom,
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: zeroPence(), // already fully used elsewhere
      isaBalance: zeroPence(),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    expect(bucketAmount(result, "taxablePersonalAllowance")).toBe(0);
    expect(bucketAmount(result, "taxableBasicRate")).toBe(0);
    expect(bucketAmount(result, "taxableHigherRate")).toBe(0);
    expect(bucketAmount(result, "taxableAdditionalRate")).toBeGreaterThan(0);
    expect(bucketAmount(result, "taxFreePensionLumpSum")).toBe(0); // no LSA remaining
    expect(result.shortfall).toBe(false);
  });

  it("reports a shortfall when pension and ISA balances together can't reach the target", () => {
    const inputs: DrawdownSolverInputs = {
      targetNetAmount: poundsToPence(100000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(5000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    };
    const result = solveDrawdown(inputs);

    expect(result.shortfall).toBe(true);
    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(5000));
    expect(result.isaGrossWithdrawn).toBe(poundsToPence(5000));
    expect(result.netAchieved).toBeLessThan(poundsToPence(100000));
  });

  it("returns nothing for a zero target", () => {
    const result = solveDrawdown({
      targetNetAmount: zeroPence(),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    });
    expect(result.buckets).toEqual([]);
    expect(result.pensionGrossWithdrawn).toBe(0);
    expect(result.isaGrossWithdrawn).toBe(0);
    expect(result.shortfall).toBe(false);
  });

  it("every bucket's amount minus its tax cost sums to the reported net achieved", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(80000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(5000),
      ...noGiaOrCash,
    });
    const netFromBuckets = sumPence(result.buckets.map((b) => pence(b.amount - b.taxCost)));
    expect(netFromBuckets).toBe(result.netAchieved);
  });
});

describe("solveDrawdown — cash and GIA", () => {
  it("draws cash principal in the free tier, alongside ISA, once the Personal Allowance is exhausted", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(20000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(2000),
      cashBalance: poundsToPence(10000),
      giaBalance: zeroPence(),
      giaCostBasis: zeroPence(),
      capitalGainsExemptAmountRemaining: ampleAea,
      capitalGainsRates: cgtRates,
    });

    // £16,760 gross pension fills the PA (net £16,760, 0% cost); £2,000 ISA; the remaining £1,240 from cash.
    const paGross = poundsToPence(Math.round((12570 / 0.75) * 100) / 100);
    const remainingAfterPaAndIsa = poundsToPence(20000) - paGross - poundsToPence(2000);
    expect(bucketAmount(result, "taxFreeCashPrincipal")).toBe(remainingAfterPaAndIsa);
    expect(result.cashGrossWithdrawn).toBe(remainingAfterPaAndIsa);
    expect(result.incomeTaxCost).toBe(0);
    expect(result.shortfall).toBe(false);
  });

  it("draws GIA tax-free while the gain stays within the CGT Annual Exempt Amount", () => {
    // £20,000 balance, £10,000 cost basis -> 50% gain fraction. £3,000 AEA / 0.5 = £6,000 gross is fully free.
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(5000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: zeroPence(),
      lumpSumAllowanceRemaining: zeroPence(),
      isaBalance: zeroPence(),
      cashBalance: zeroPence(),
      giaBalance: poundsToPence(20000),
      giaCostBasis: poundsToPence(10000),
      capitalGainsExemptAmountRemaining: ampleAea,
      capitalGainsRates: cgtRates,
    });

    expect(result.giaGrossWithdrawn).toBe(poundsToPence(5000));
    expect(bucketAmount(result, "taxFreeGIAReturnOfCapital")).toBe(poundsToPence(2500)); // 50% of £5,000
    expect(bucketAmount(result, "capitalGainWithinAllowance")).toBe(poundsToPence(2500)); // the other 50%, within the AEA
    expect(result.capitalGainsExemptAmountUsed).toBe(poundsToPence(2500));
    expect(result.capitalGainsTaxCost).toBe(0);
    expect(result.netAchieved).toBe(poundsToPence(5000));
    expect(result.shortfall).toBe(false);
  });

  it("charges CGT on GIA gains once the Annual Exempt Amount is exhausted", () => {
    // 50% gain fraction, £3,000 AEA -> the first £6,000 gross is free; more than that starts incurring CGT on the gain portion.
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(16000),
      bandHeadroom: headroomWithNoOtherIncome(), // basic rate CGT applies (18%)
      pensionBalance: zeroPence(),
      lumpSumAllowanceRemaining: zeroPence(),
      isaBalance: zeroPence(),
      cashBalance: zeroPence(),
      giaBalance: poundsToPence(100000),
      giaCostBasis: poundsToPence(50000),
      capitalGainsExemptAmountRemaining: ampleAea,
      capitalGainsRates: cgtRates,
    });

    expect(result.capitalGainsExemptAmountUsed).toBe(ampleAea); // fully used
    expect(bucketAmount(result, "capitalGainTaxable")).toBeGreaterThan(0);
    expect(result.capitalGainsTaxCost).toBeGreaterThan(0);
    expect(Math.abs(result.netAchieved - poundsToPence(16000))).toBeLessThanOrEqual(5);
    expect(result.shortfall).toBe(false);
  });

  it("prefers GIA over pension at a band once the Lump Sum Allowance is exhausted and the GIA's gain fraction is low enough to net more", () => {
    // With no LSA left, pension nets (1 - 0.2) = 0.80 per gross pound at basic rate.
    // A GIA with a 10% gain fraction (mostly cost basis) nets (1 - 0.1*0.18) = 0.982 per gross pound
    // (once its own AEA is exhausted) — clearly better than pension's 0.80, so the solver should draw
    // from the GIA before touching pension at this band, given both are offered.
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(20000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: zeroPence(), // already exhausted — no UFPLS bonus available
      isaBalance: zeroPence(),
      cashBalance: zeroPence(),
      giaBalance: poundsToPence(500000),
      giaCostBasis: poundsToPence(450000), // 10% gain fraction
      capitalGainsExemptAmountRemaining: zeroPence(), // already exhausted — isolates the comparison to the taxed tier
      capitalGainsRates: cgtRates,
    });

    // The PA-band step still draws pension first (SPEC.md §5.7.3 step 1 is
    // unconditional) — with no Lump Sum Allowance left, that's a plain
    // 1:1 (no UFPLS grossing) fill of the £12,570 Personal Allowance;
    // GIA should cover the rest at the basic band, since it nets more per pound there.
    expect(Math.abs(result.pensionGrossWithdrawn - fullAllowance)).toBeLessThanOrEqual(5);
    expect(result.giaGrossWithdrawn).toBeGreaterThan(0);
    expect(bucketAmount(result, "taxableBasicRate")).toBe(0);
  });

  it("reports a shortfall only once pension, ISA, cash, and GIA are all exhausted", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(100000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(2000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(2000),
      cashBalance: poundsToPence(2000),
      giaBalance: poundsToPence(2000),
      giaCostBasis: poundsToPence(2000),
      capitalGainsExemptAmountRemaining: ampleAea,
      capitalGainsRates: cgtRates,
    });

    expect(result.shortfall).toBe(true);
    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(2000));
    expect(result.isaGrossWithdrawn).toBe(poundsToPence(2000));
    expect(result.cashGrossWithdrawn).toBe(poundsToPence(2000));
    expect(result.giaGrossWithdrawn).toBe(poundsToPence(2000));
  });
});

describe("solveDrawdown — taxable/non-taxable preference (taxablePreferenceAmount)", () => {
  it("draws exactly the preferred amount from pension and the rest from ISA, when both have ample capacity", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(20000),
      taxablePreferenceAmount: poundsToPence(8000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(20000),
      ...noGiaOrCash,
    });

    // £8,000 is well within the £12,570 Personal Allowance — entirely tax-free, so gross = net.
    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(8000));
    expect(result.incomeTaxCost).toBe(0);
    expect(result.isaGrossWithdrawn).toBe(poundsToPence(12000));
    expect(result.netAchieved).toBe(poundsToPence(20000));
    expect(result.shortfall).toBe(false);
  });

  it("falls back to ISA once the pension balance runs short of the taxable preference", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(20000),
      taxablePreferenceAmount: poundsToPence(8000),
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(3000), // less than the £8,000 preferred
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(50000),
      ...noGiaOrCash,
    });

    // Pension is fully drained (all of it tax-free, within the PA) — the £5,000 it couldn't
    // supply, plus the rest of the target, is covered by the ISA instead.
    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(3000));
    expect(result.isaGrossWithdrawn).toBe(poundsToPence(17000));
    expect(result.netAchieved).toBe(poundsToPence(20000));
    expect(result.shortfall).toBe(false);
  });

  it("falls back to pension once ISA/cash/GIA can't cover the non-taxable share", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(20000),
      taxablePreferenceAmount: poundsToPence(5000), // a small preferred pension share — most should come from ISA
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(2000), // far short of the £15,000 non-taxable share
      ...noGiaOrCash,
    });

    // The ISA is fully drained, and pension makes up the rest regardless of the £5,000 preference.
    expect(result.isaGrossWithdrawn).toBe(poundsToPence(2000));
    expect(result.pensionGrossWithdrawn).toBeGreaterThan(poundsToPence(5000));
    expect(result.netAchieved).toBe(poundsToPence(20000));
    expect(result.shortfall).toBe(false);
  });

  it("caps the taxable preference at the target itself — never asks pension for more than what's actually needed", () => {
    const result = solveDrawdown({
      targetNetAmount: poundsToPence(5000),
      taxablePreferenceAmount: poundsToPence(20000), // far more than the target needs
      bandHeadroom: headroomWithNoOtherIncome(),
      pensionBalance: poundsToPence(500000),
      lumpSumAllowanceRemaining: ampleLsa,
      isaBalance: poundsToPence(50000),
      ...noGiaOrCash,
    });

    expect(result.pensionGrossWithdrawn).toBe(poundsToPence(5000));
    expect(result.isaGrossWithdrawn).toBe(0);
    expect(result.netAchieved).toBe(poundsToPence(5000));
    expect(result.shortfall).toBe(false);
  });
});
