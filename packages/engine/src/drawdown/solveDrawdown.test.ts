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
    });
    const netFromBuckets = sumPence(result.buckets.map((b) => pence(b.amount - b.taxCost)));
    expect(netFromBuckets).toBe(result.netAchieved);
  });
});
