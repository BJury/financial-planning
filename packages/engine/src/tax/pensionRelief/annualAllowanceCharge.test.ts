import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { buildFullBandStack, type IncomeTaxBand } from "../incomeTax.js";
import { calculateAnnualAllowanceCharge } from "./annualAllowanceCharge.js";

const standardBands: readonly IncomeTaxBand[] = [
  { name: "basic", upTo: poundsToPence(50270), rate: 0.2 },
  { name: "higher", upTo: poundsToPence(125140), rate: 0.4 },
  { name: "additional", upTo: null, rate: 0.45 },
];
const fullBands = buildFullBandStack(poundsToPence(12570), standardBands);

describe("calculateAnnualAllowanceCharge", () => {
  it("charges nothing for a zero excess", () => {
    expect(calculateAnnualAllowanceCharge(poundsToPence(60000), pence(0), fullBands)).toBe(0);
  });

  it("charges the excess at the person's marginal rate — basic-rate example", () => {
    // Someone with £30,000 other taxable income (comfortably basic rate)
    // and a £5,000 excess: the excess is taxed entirely at 20%.
    const charge = calculateAnnualAllowanceCharge(poundsToPence(30000), poundsToPence(5000), fullBands);
    expect(charge).toBe(poundsToPence(5000 * 0.2));
  });

  it("charges the excess at higher rate when it pushes a higher-rate taxpayer further into that band", () => {
    // £80,000 other taxable income (already in the 40% band) + £5,000 excess, all at 40%.
    const charge = calculateAnnualAllowanceCharge(poundsToPence(80000), poundsToPence(5000), fullBands);
    expect(charge).toBe(poundsToPence(5000 * 0.4));
  });

  it("splits the excess across bands correctly when it straddles a boundary", () => {
    // £48,000 other taxable income (basic rate, £2,270 of headroom before
    // the £50,270 boundary) + £5,000 excess: £2,270 @ 20%, £2,730 @ 40%.
    const charge = calculateAnnualAllowanceCharge(poundsToPence(48000), poundsToPence(5000), fullBands);
    const expected = poundsToPence(2270 * 0.2 + 2730 * 0.4);
    expect(charge).toBe(expected);
  });
});
