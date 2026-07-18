import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../money/pence.js";
import { ruleSet2026_27 } from "../taxYearData/2026-27.js";
import {
  applyIncomeTaxBands,
  buildFullBandStack,
  computeRemainingBandHeadroom,
  taperPersonalAllowance,
  type IncomeTaxBand,
} from "./incomeTax.js";

// The 2026/27 standard rate bands (Personal Allowance excluded — that's
// added separately via buildFullBandStack, mirroring how the engine
// actually composes these two functions).
const standardBands: readonly IncomeTaxBand[] = ruleSet2026_27.incomeTaxEngland.bands.map((b) => ({
  name: b.name,
  upTo: b.upTo === null ? null : poundsToPence(b.upTo),
  rate: b.rate,
}));

const fullAllowance = poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowance);
const taperThreshold = poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowanceTaperThreshold);
const taperRate = ruleSet2026_27.incomeTaxEngland.personalAllowanceTaperRate;

describe("applyIncomeTaxBands", () => {
  const bands = buildFullBandStack(fullAllowance, standardBands);

  it("charges nothing on income within the Personal Allowance", () => {
    expect(applyIncomeTaxBands(poundsToPence(10000), bands)).toBe(0);
    expect(applyIncomeTaxBands(fullAllowance, bands)).toBe(0);
  });

  it("charges basic rate on income just above the Personal Allowance", () => {
    // £12,571 taxable: £1 into the basic rate band at 20% = 20p
    const income = pence(fullAllowance + 100); // +£1
    expect(applyIncomeTaxBands(income, bands)).toBe(20);
  });

  it("matches a known HMRC-style worked example: £45,000 salary", () => {
    // £45,000 total income: £12,570 at 0%, remaining £32,430 at 20%
    const income = poundsToPence(45000);
    const expectedTax = poundsToPence(32430 * 0.2);
    expect(applyIncomeTaxBands(income, bands)).toBe(expectedTax);
  });

  it("stacks basic and higher rate correctly at the boundary", () => {
    // £50,270 exactly: all of it within basic rate (£12,570 @ 0% + £37,700 @ 20%)
    const atBoundary = poundsToPence(50270);
    expect(applyIncomeTaxBands(atBoundary, bands)).toBe(poundsToPence(37700 * 0.2));

    // £50,271: one extra pound taxed at 40%, not 20%
    const onePoundOver = pence(atBoundary + 100);
    expect(applyIncomeTaxBands(onePoundOver, bands)).toBe(poundsToPence(37700 * 0.2) + 40);
  });

  it("stacks into the additional rate band with no upper bound", () => {
    // £200,000: £12,570 @ 0%, £37,700 @ 20%, £74,870 @ 40%, £74,860 @ 45%
    const income = poundsToPence(200000);
    const expected =
      poundsToPence(37700 * 0.2) + poundsToPence(74870 * 0.4) + poundsToPence(74860 * 0.45);
    expect(applyIncomeTaxBands(income, bands)).toBe(expected);
  });

  it("returns zero tax for zero income", () => {
    expect(applyIncomeTaxBands(pence(0), bands)).toBe(0);
  });
});

describe("taperPersonalAllowance", () => {
  it("returns the full allowance below the taper threshold", () => {
    expect(taperPersonalAllowance(poundsToPence(99999), fullAllowance, taperThreshold, taperRate)).toBe(
      fullAllowance,
    );
  });

  it("returns the full allowance exactly at the taper threshold", () => {
    expect(taperPersonalAllowance(taperThreshold, fullAllowance, taperThreshold, taperRate)).toBe(fullAllowance);
  });

  it("reduces by £1 for every £2 above the threshold", () => {
    // £10,000 over the threshold -> £5,000 reduction
    const income = pence(taperThreshold + poundsToPence(10000));
    expect(taperPersonalAllowance(income, fullAllowance, taperThreshold, taperRate)).toBe(
      pence(fullAllowance - poundsToPence(5000)),
    );
  });

  it("reaches exactly zero at the known HMRC boundary (£125,140 adjusted net income for 2026/27)", () => {
    const fullyTapered = poundsToPence(125140);
    expect(taperPersonalAllowance(fullyTapered, fullAllowance, taperThreshold, taperRate)).toBe(0);
  });

  it("never goes negative beyond the point the allowance reaches zero", () => {
    const wayOver = poundsToPence(500000);
    expect(taperPersonalAllowance(wayOver, fullAllowance, taperThreshold, taperRate)).toBe(0);
  });
});

describe("buildFullBandStack", () => {
  it("prepends the tapered allowance as a 0% band ahead of the standard bands", () => {
    const stack = buildFullBandStack(fullAllowance, standardBands);
    expect(stack[0]).toEqual({ name: "personalAllowance", upTo: fullAllowance, rate: 0 });
    expect(stack.slice(1)).toEqual(standardBands);
  });

  it("composes correctly with a fully-tapered (£0) allowance", () => {
    const stack = buildFullBandStack(pence(0), standardBands);
    // With no allowance, the very first pound is taxed at the basic rate.
    expect(applyIncomeTaxBands(pence(100), stack)).toBe(20);
  });
});

describe("computeRemainingBandHeadroom", () => {
  const bands = buildFullBandStack(fullAllowance, standardBands);

  it("with no other income, every band's full width is remaining", () => {
    const headroom = computeRemainingBandHeadroom(bands, pence(0));
    expect(headroom.find((b) => b.name === "personalAllowance")?.remainingWidth).toBe(fullAllowance);
    expect(headroom.find((b) => b.name === "basic")?.remainingWidth).toBe(poundsToPence(37700));
    expect(headroom.find((b) => b.name === "higher")?.remainingWidth).toBe(poundsToPence(74870));
    expect(headroom.find((b) => b.name === "additional")?.remainingWidth).toBeNull();
  });

  it("reduces the Personal Allowance band's headroom by other income within it", () => {
    const headroom = computeRemainingBandHeadroom(bands, poundsToPence(5000));
    expect(headroom.find((b) => b.name === "personalAllowance")?.remainingWidth).toBe(
      pence(fullAllowance - poundsToPence(5000)),
    );
    // Nothing yet spills into the basic band.
    expect(headroom.find((b) => b.name === "basic")?.remainingWidth).toBe(poundsToPence(37700));
  });

  it("zeroes out the Personal Allowance and partially consumes the basic band once other income exceeds the allowance", () => {
    // £20,000 other income: £12,570 fills the PA entirely, £7,430 spills into the basic band.
    const headroom = computeRemainingBandHeadroom(bands, poundsToPence(20000));
    expect(headroom.find((b) => b.name === "personalAllowance")?.remainingWidth).toBe(0);
    expect(headroom.find((b) => b.name === "basic")?.remainingWidth).toBe(pence(poundsToPence(37700) - poundsToPence(7430)));
  });

  it("leaves every band at zero remaining width once other income already exceeds the top finite band's ceiling", () => {
    const headroom = computeRemainingBandHeadroom(bands, poundsToPence(200000));
    expect(headroom.find((b) => b.name === "personalAllowance")?.remainingWidth).toBe(0);
    expect(headroom.find((b) => b.name === "basic")?.remainingWidth).toBe(0);
    expect(headroom.find((b) => b.name === "higher")?.remainingWidth).toBe(0);
    // The unbounded top band always reports null, regardless of how much other income there already is.
    expect(headroom.find((b) => b.name === "additional")?.remainingWidth).toBeNull();
  });
});
