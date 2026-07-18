import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { buildFullBandStack } from "./incomeTax.js";
import { calculateCapitalGainsTax, type CapitalGainsRates } from "./capitalGainsTax.js";

const standardBands = [
  { name: "basic", upTo: poundsToPence(50270), rate: 0.2 },
  { name: "higher", upTo: poundsToPence(125140), rate: 0.4 },
  { name: "additional", upTo: null, rate: 0.45 },
];
const fullAllowance = poundsToPence(12570);
const fullBands = buildFullBandStack(fullAllowance, standardBands);
const cgtRates: CapitalGainsRates = { basicRate: 0.18, higherRate: 0.24 };
const annualExemptAmount = poundsToPence(3000);

describe("calculateCapitalGainsTax", () => {
  it("charges nothing when the gain is fully within the Annual Exempt Amount", () => {
    const tax = calculateCapitalGainsTax(poundsToPence(30000), poundsToPence(3000), annualExemptAmount, fullBands, cgtRates);
    expect(tax).toBe(0);
  });

  it("charges the basic CGT rate on the excess for a basic-rate taxpayer", () => {
    const tax = calculateCapitalGainsTax(poundsToPence(30000), poundsToPence(5000), annualExemptAmount, fullBands, cgtRates);
    expect(tax).toBe(poundsToPence(2000 * 0.18));
  });

  it("charges the higher CGT rate for a higher-rate taxpayer", () => {
    const tax = calculateCapitalGainsTax(poundsToPence(80000), poundsToPence(5000), annualExemptAmount, fullBands, cgtRates);
    expect(tax).toBe(poundsToPence(2000 * 0.24));
    expect(tax).not.toBe(poundsToPence(2000 * 0.4)); // not the standard higher Income Tax rate
  });

  it("charges the higher CGT rate (not a separate additional-rate tier) for an additional-rate taxpayer", () => {
    const tax = calculateCapitalGainsTax(poundsToPence(200000), poundsToPence(5000), annualExemptAmount, fullBands, cgtRates);
    expect(tax).toBe(poundsToPence(2000 * 0.24));
  });

  it("taxes entirely at the higher rate when the allowance itself exhausts the remaining basic-band headroom", () => {
    // £48,000 other income leaves £2,270 of basic-band headroom. The
    // £3,000 AEA covers that £2,270 (still 0%) plus £730 more, spilling
    // into the higher band — so the AEA itself is what pushes the
    // *taxable* remainder (£8,000 - £3,000 = £5,000) entirely into the
    // higher-rate band, none of it landing in the (now fully consumed,
    // allowance-only) basic band.
    const tax = calculateCapitalGainsTax(poundsToPence(48000), poundsToPence(8000), annualExemptAmount, fullBands, cgtRates);
    expect(tax).toBe(poundsToPence(5000 * 0.24));
  });

  it("splits the taxable portion across both rates when the allowance is fully absorbed within the basic band, leaving genuine basic-band capacity", () => {
    // £45,000 other income leaves £5,270 of basic-band headroom — enough
    // to fully absorb the £3,000 AEA *and* leave £2,270 of real taxable
    // basic-band capacity before the rest spills into the higher rate.
    const tax = calculateCapitalGainsTax(poundsToPence(45000), poundsToPence(10000), annualExemptAmount, fullBands, cgtRates);
    const expected = poundsToPence(2270 * 0.18) + poundsToPence(4730 * 0.24);
    expect(tax).toBe(expected);
  });

  it("returns zero for a zero gain", () => {
    expect(calculateCapitalGainsTax(poundsToPence(30000), zeroPence(), annualExemptAmount, fullBands, cgtRates)).toBe(0);
  });
});
