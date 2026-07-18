import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { buildFullBandStack } from "./incomeTax.js";
import { calculateSavingsTax, determinePersonalSavingsAllowance, type SavingsAllowanceByBand } from "./savingsTax.js";

const standardBands = [
  { name: "basic", upTo: poundsToPence(50270), rate: 0.2 },
  { name: "higher", upTo: poundsToPence(125140), rate: 0.4 },
  { name: "additional", upTo: null, rate: 0.45 },
];
const fullAllowance = poundsToPence(12570);
const fullBands = buildFullBandStack(fullAllowance, standardBands);

const savingsAllowance: SavingsAllowanceByBand = {
  basicRatePayer: poundsToPence(1000),
  higherRatePayer: poundsToPence(500),
  additionalRatePayer: zeroPence(),
};

describe("determinePersonalSavingsAllowance", () => {
  it("gives the basic-rate PSA to someone entirely within the Personal Allowance", () => {
    expect(determinePersonalSavingsAllowance(poundsToPence(10000), fullBands, savingsAllowance)).toBe(poundsToPence(1000));
  });

  it("gives the basic-rate PSA to a basic-rate taxpayer", () => {
    expect(determinePersonalSavingsAllowance(poundsToPence(40000), fullBands, savingsAllowance)).toBe(poundsToPence(1000));
  });

  it("gives the higher-rate PSA to a higher-rate taxpayer", () => {
    expect(determinePersonalSavingsAllowance(poundsToPence(80000), fullBands, savingsAllowance)).toBe(poundsToPence(500));
  });

  it("gives no PSA (£0) to an additional-rate taxpayer", () => {
    expect(determinePersonalSavingsAllowance(poundsToPence(200000), fullBands, savingsAllowance)).toBe(0);
  });
});

describe("calculateSavingsTax", () => {
  it("charges nothing when interest is fully within the PSA", () => {
    const tax = calculateSavingsTax(poundsToPence(40000), poundsToPence(1000), poundsToPence(1000), fullBands);
    expect(tax).toBe(0);
  });

  it("charges basic rate on interest above the PSA for a basic-rate taxpayer", () => {
    const tax = calculateSavingsTax(poundsToPence(40000), poundsToPence(1500), poundsToPence(1000), fullBands);
    expect(tax).toBe(poundsToPence(500 * 0.2));
  });

  it("charges higher rate on interest for a higher-rate taxpayer, using their smaller PSA", () => {
    const tax = calculateSavingsTax(poundsToPence(80000), poundsToPence(1000), poundsToPence(500), fullBands);
    expect(tax).toBe(poundsToPence(500 * 0.4));
  });

  it("charges the full amount at additional rate when there's no PSA left", () => {
    const tax = calculateSavingsTax(poundsToPence(200000), poundsToPence(1000), zeroPence(), fullBands);
    expect(tax).toBe(poundsToPence(1000 * 0.45));
  });
});
