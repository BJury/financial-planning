import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { ruleSet2026_27 } from "../../taxYearData/2026-27.js";
import { applyIncomeTaxBands, buildFullBandStack, type IncomeTaxBand } from "../incomeTax.js";
import { extendBandsForReliefAtSource, grossUpAtBasicRate } from "./reliefAtSource.js";

const basicRate = ruleSet2026_27.incomeTaxEngland.bands.find((b) => b.name === "basic")?.rate ?? 0;

describe("grossUpAtBasicRate", () => {
  it("grosses up a net contribution by the basic rate (20%)", () => {
    // £800 paid from net pay -> £1,000 gross in the pot at 20% basic rate
    expect(grossUpAtBasicRate(poundsToPence(800), basicRate)).toBe(poundsToPence(1000));
  });

  it("is a no-op at a zero basic rate", () => {
    expect(grossUpAtBasicRate(poundsToPence(500), 0)).toBe(poundsToPence(500));
  });
});

describe("extendBandsForReliefAtSource", () => {
  const standardBands: readonly IncomeTaxBand[] = ruleSet2026_27.incomeTaxEngland.bands.map((b) => ({
    name: b.name,
    upTo: b.upTo === null ? null : poundsToPence(b.upTo),
    rate: b.rate,
  }));

  it("extends the basic and higher rate band ceilings by the gross contribution", () => {
    const grossContribution = poundsToPence(8000);
    const extended = extendBandsForReliefAtSource(standardBands, grossContribution);

    const originalBasic = standardBands.find((b) => b.name === "basic");
    const extendedBasic = extended.find((b) => b.name === "basic");
    expect(extendedBasic?.upTo).toBe(pence((originalBasic?.upTo ?? 0) + grossContribution));

    const originalHigher = standardBands.find((b) => b.name === "higher");
    const extendedHigher = extended.find((b) => b.name === "higher");
    expect(extendedHigher?.upTo).toBe(pence((originalHigher?.upTo ?? 0) + grossContribution));
  });

  it("leaves the unbounded (additional-rate) band untouched", () => {
    const extended = extendBandsForReliefAtSource(standardBands, poundsToPence(8000));
    const additional = extended.find((b) => b.name === "additional");
    expect(additional?.upTo).toBeNull();
  });

  it("is a no-op for a zero contribution", () => {
    const extended = extendBandsForReliefAtSource(standardBands, pence(0));
    expect(extended).toEqual(standardBands);
  });

  it("reduces the amount taxed at higher rate by exactly the gross contribution", () => {
    const fullAllowance = poundsToPence(ruleSet2026_27.incomeTaxEngland.personalAllowance);
    const grossContribution = poundsToPence(8000);
    const income = poundsToPence(80000);

    const withoutRelief = applyIncomeTaxBands(income, buildFullBandStack(fullAllowance, standardBands));
    const extendedBands = extendBandsForReliefAtSource(standardBands, grossContribution);
    const withRelief = applyIncomeTaxBands(income, buildFullBandStack(fullAllowance, extendedBands));

    // £8,000 of income that would have been taxed at 40% is now taxed at
    // 20% instead: tax saving = £8,000 * (0.40 - 0.20) = £1,600.
    const expectedSaving = poundsToPence(8000 * (0.4 - 0.2));
    expect(pence(withoutRelief - withRelief)).toBe(expectedSaving);
  });
});
