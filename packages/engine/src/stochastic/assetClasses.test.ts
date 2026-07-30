import { describe, expect, it } from "vitest";
import { MONTE_CARLO_DEFAULT_PRESETS, monteCarloPresetsWithMean } from "./assetClasses.js";

const ASSET_CLASSES = ["usEquities", "ukEquities", "bonds", "cash"] as const;

describe("monteCarloPresetsWithMean", () => {
  it("sets every asset class's mean to the given value", () => {
    const presets = monteCarloPresetsWithMean(0.025);
    for (const assetClass of ASSET_CLASSES) expect(presets[assetClass].meanReturn).toBe(0.025);
  });

  it("leaves each asset class's volatility untouched from the sourced default", () => {
    const presets = monteCarloPresetsWithMean(0.025);
    for (const assetClass of ASSET_CLASSES) expect(presets[assetClass].volatility).toBe(MONTE_CARLO_DEFAULT_PRESETS[assetClass].volatility);
  });

  it("reflects a different mean on a second call (not memoized to the first)", () => {
    expect(monteCarloPresetsWithMean(0.02).usEquities.meanReturn).toBe(0.02);
    expect(monteCarloPresetsWithMean(0.04).usEquities.meanReturn).toBe(0.04);
  });

  it("carries each asset class's degreesOfFreedom through unchanged", () => {
    const presets = monteCarloPresetsWithMean(0.025);
    for (const assetClass of ASSET_CLASSES) {
      expect(presets[assetClass].degreesOfFreedom).toBe(MONTE_CARLO_DEFAULT_PRESETS[assetClass].degreesOfFreedom);
    }
  });
});

describe("MONTE_CARLO_DEFAULT_PRESETS — sourced from the bundled dataset", () => {
  it("gives every asset class a positive volatility", () => {
    for (const assetClass of ASSET_CLASSES) expect(MONTE_CARLO_DEFAULT_PRESETS[assetClass].volatility).toBeGreaterThan(0);
  });

  it("gives any asset class with a fat-tail adjustment a degreesOfFreedom above the variance-validity floor", () => {
    for (const assetClass of ASSET_CLASSES) {
      const dof = MONTE_CARLO_DEFAULT_PRESETS[assetClass].degreesOfFreedom;
      if (dof !== undefined) expect(dof).toBeGreaterThan(2);
    }
  });
});
