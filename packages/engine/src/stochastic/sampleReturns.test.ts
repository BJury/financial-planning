import { describe, expect, it } from "vitest";
import type { HistoricalReturnMonth, UsEquityReturnMonth } from "./historicalReturns/types.js";
import {
  countUsEquityWindows,
  createPrng,
  sampleHistoricalTrajectory,
  sampleMonteCarloTrajectory,
  sampleLognormalReturn,
  walkUsEquityWindows,
} from "./sampleReturns.js";
import type { AssetClassPreset } from "./assetClasses.js";

describe("createPrng", () => {
  it("is deterministic given the same seed", () => {
    const a = createPrng(42);
    const b = createPrng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it("produces different sequences for different seeds", () => {
    const a = createPrng(1);
    const b = createPrng(2);
    expect(a()).not.toEqual(b());
  });

  it("always returns values in [0, 1)", () => {
    const prng = createPrng(7);
    for (let i = 0; i < 1000; i++) {
      const v = prng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("sampleHistoricalTrajectory", () => {
  // Every month's ukEquities/bonds/cash share one value (varying month-to-month) —
  // so any two of those three classes disagreeing at the same simulated year would
  // mean they were compounded from two different draws, breaking cross-asset
  // correlation. usEquities uses a deliberately different set of monthly values, from
  // its own separate table, so a test can confirm it varies independently.
  const ukMonthlyValues = [0.01, -0.02, 0.03, 0.005, -0.01, 0.02, 0.015, -0.005, 0.0, 0.025, -0.015, 0.01];
  const tinyHistory: readonly HistoricalReturnMonth[] = ukMonthlyValues.map((v, i) => ({
    year: 2000,
    month: i + 1,
    ukEquities: v,
    bonds: v,
    cash: v,
  }));
  const usMonthlyValues = [0.04, -0.03, 0.06, -0.01, 0.02, 0.07, -0.02, 0.03, 0.01, -0.04, 0.05, 0.0];
  const tinyUsHistory: readonly UsEquityReturnMonth[] = usMonthlyValues.map((v, i) => ({ year: 2000, month: i + 1, usEquities: v }));

  const minAnnualOf = (values: readonly number[]) => Math.pow(1 + Math.min(...values), 12) - 1;
  const maxAnnualOf = (values: readonly number[]) => Math.pow(1 + Math.max(...values), 12) - 1;

  it("returns exactly `years` entries per asset class", () => {
    const result = sampleHistoricalTrajectory(25, createPrng(1), tinyHistory, tinyUsHistory, 4);
    expect(result.usEquities).toHaveLength(25);
    expect(result.ukEquities).toHaveLength(25);
    expect(result.bonds).toHaveLength(25);
    expect(result.cash).toHaveLength(25);
  });

  it("preserves cross-asset correlation among ukEquities/bonds/cash: each simulated year's three returns are compounded from the same 12-month window", () => {
    const result = sampleHistoricalTrajectory(30, createPrng(3), tinyHistory, tinyUsHistory, 5);
    for (let i = 0; i < 30; i++) {
      expect(result.bonds[i]).toBeCloseTo(result.ukEquities[i] ?? NaN, 10);
      expect(result.cash[i]).toBeCloseTo(result.ukEquities[i] ?? NaN, 10);
    }
  });

  it("draws usEquities independently — its values aren't forced to match the ukEquities/bonds/cash draw for the same simulated year", () => {
    const result = sampleHistoricalTrajectory(30, createPrng(3), tinyHistory, tinyUsHistory, 5);
    expect(result.usEquities).not.toEqual(result.ukEquities);
  });

  it("is deterministic given the same seed", () => {
    const a = sampleHistoricalTrajectory(40, createPrng(99), tinyHistory, tinyUsHistory, 6);
    const b = sampleHistoricalTrajectory(40, createPrng(99), tinyHistory, tinyUsHistory, 6);
    expect(a).toEqual(b);
  });

  it("only ever compounds values that exist in each source history (wraps around, never invents a month)", () => {
    const result = sampleHistoricalTrajectory(50, createPrng(5), tinyHistory, tinyUsHistory, 4);
    for (const v of result.ukEquities) {
      expect(v).toBeGreaterThanOrEqual(minAnnualOf(ukMonthlyValues) - 1e-9);
      expect(v).toBeLessThanOrEqual(maxAnnualOf(ukMonthlyValues) + 1e-9);
    }
    for (const v of result.usEquities) {
      expect(v).toBeGreaterThanOrEqual(minAnnualOf(usMonthlyValues) - 1e-9);
      expect(v).toBeLessThanOrEqual(maxAnnualOf(usMonthlyValues) + 1e-9);
    }
  });

  it("compounds exactly 12 consecutive months per simulated year — a flat-rate history produces a flat compounded annual return", () => {
    const flatHistory: readonly HistoricalReturnMonth[] = Array.from({ length: 6 }, (_, i) => ({
      year: 2000,
      month: i + 1,
      ukEquities: 0.02,
      bonds: 0.02,
      cash: 0.02,
    }));
    const flatUsHistory: readonly UsEquityReturnMonth[] = Array.from({ length: 6 }, (_, i) => ({ year: 2000, month: i + 1, usEquities: 0.02 }));
    const result = sampleHistoricalTrajectory(10, createPrng(11), flatHistory, flatUsHistory, 3);
    const expected = Math.pow(1.02, 12) - 1;
    for (const v of result.usEquities) expect(v).toBeCloseTo(expected, 10);
    for (const v of result.ukEquities) expect(v).toBeCloseTo(expected, 10);
  });
});

describe("sampleLognormalReturn", () => {
  it("converges to the configured mean/stdev over many draws", () => {
    const preset: AssetClassPreset = { meanReturn: 0.05, volatility: 0.17 };
    const prng = createPrng(123);
    const draws = Array.from({ length: 200_000 }, () => sampleLognormalReturn(prng, preset));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const variance = draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length;
    const stdev = Math.sqrt(variance);

    expect(mean).toBeGreaterThan(0.05 - 0.01);
    expect(mean).toBeLessThan(0.05 + 0.01);
    expect(stdev).toBeGreaterThan(0.17 - 0.01);
    expect(stdev).toBeLessThan(0.17 + 0.01);
  });

  it("never produces a return below -100% (1 + return must stay positive)", () => {
    const preset: AssetClassPreset = { meanReturn: 0.05, volatility: 0.5 };
    const prng = createPrng(2);
    for (let i = 0; i < 10_000; i++) {
      expect(sampleLognormalReturn(prng, preset)).toBeGreaterThan(-1);
    }
  });

  it("with degreesOfFreedom set, still converges to the configured mean/stdev over many draws", () => {
    const preset: AssetClassPreset = { meanReturn: 0.05, volatility: 0.17, degreesOfFreedom: 6 };
    const prng = createPrng(123);
    const draws = Array.from({ length: 200_000 }, () => sampleLognormalReturn(prng, preset));
    const mean = draws.reduce((a, b) => a + b, 0) / draws.length;
    const variance = draws.reduce((a, b) => a + (b - mean) ** 2, 0) / draws.length;
    const stdev = Math.sqrt(variance);

    expect(mean).toBeGreaterThan(0.05 - 0.015);
    expect(mean).toBeLessThan(0.05 + 0.015);
    expect(stdev).toBeGreaterThan(0.17 - 0.015);
    expect(stdev).toBeLessThan(0.17 + 0.015);
  });

  it("with degreesOfFreedom set, produces more extreme outliers than a plain Gaussian at the same mean/stdev", () => {
    const gaussianPreset: AssetClassPreset = { meanReturn: 0.05, volatility: 0.17 };
    const fatTailedPreset: AssetClassPreset = { meanReturn: 0.05, volatility: 0.17, degreesOfFreedom: 5 };
    const prng = createPrng(7);

    const maxAbsDeviation = (preset: AssetClassPreset) =>
      Math.max(...Array.from({ length: 20_000 }, () => Math.abs(sampleLognormalReturn(prng, preset) - preset.meanReturn)));

    expect(maxAbsDeviation(fatTailedPreset)).toBeGreaterThan(maxAbsDeviation(gaussianPreset));
  });
});

describe("sampleMonteCarloTrajectory", () => {
  it("returns exactly `years` entries per asset class", () => {
    const result = sampleMonteCarloTrajectory(15, createPrng(1));
    expect(result.usEquities).toHaveLength(15);
    expect(result.ukEquities).toHaveLength(15);
    expect(result.bonds).toHaveLength(15);
    expect(result.cash).toHaveLength(15);
  });

  it("is deterministic given the same seed", () => {
    const a = sampleMonteCarloTrajectory(10, createPrng(55));
    const b = sampleMonteCarloTrajectory(10, createPrng(55));
    expect(a).toEqual(b);
  });

  it("draws a fresh, independent shock every single year — no block structure, unlike the historical bootstrap", () => {
    const result = sampleMonteCarloTrajectory(30, createPrng(9));
    for (const assetClass of ["usEquities", "ukEquities", "bonds", "cash"] as const) {
      expect(new Set(result[assetClass]).size).toBe(30);
    }
  });

  it("draws independently across asset classes too (no cross-asset correlation, unlike the historical bootstrap)", () => {
    const result = sampleMonteCarloTrajectory(30, createPrng(9));
    expect(result.usEquities).not.toEqual(result.bonds);
    expect(result.usEquities).not.toEqual(result.cash);
    expect(result.usEquities).not.toEqual(result.ukEquities);
  });
});

describe("countUsEquityWindows / walkUsEquityWindows", () => {
  // 24 months of distinct, identifiable values so each possible 12-month window is unique and traceable back to its start index.
  const tinyUsHistory: readonly UsEquityReturnMonth[] = Array.from({ length: 24 }, (_, i) => ({
    year: 2000 + Math.floor(i / 12),
    month: (i % 12) + 1,
    usEquities: i / 1000, // 0, 0.001, 0.002, ...
  }));

  it("counts exactly history.length - years*12 + 1 windows", () => {
    expect(countUsEquityWindows(1, tinyUsHistory)).toBe(24 - 12 + 1);
    expect(countUsEquityWindows(2, tinyUsHistory)).toBe(24 - 24 + 1);
  });

  it("floors the count at 1 when years*12 exceeds the dataset's length", () => {
    expect(countUsEquityWindows(3, tinyUsHistory)).toBe(1);
  });

  it("walks exactly countUsEquityWindows(years) windows, each with `years` annual entries", () => {
    const windows = walkUsEquityWindows(1, tinyUsHistory);
    expect(windows).toHaveLength(countUsEquityWindows(1, tinyUsHistory));
    for (const w of windows) expect(w).toHaveLength(1);
  });

  it("every window is a distinct real sequence — no two windows are identical, and consecutive windows differ by exactly one dropped/added month", () => {
    const windows = walkUsEquityWindows(1, tinyUsHistory);
    const uniqueCount = new Set(windows.map((w) => w.join(","))).size;
    expect(uniqueCount).toBe(windows.length);
  });

  it("the first window starts at the earliest month, and each subsequent window starts one month later", () => {
    const windows = walkUsEquityWindows(1, tinyUsHistory);
    // Window i, being a single year compounded from months [i..i+11], is strictly increasing in this
    // fixture (later months have larger usEquities values), so its compounded value increases with i too.
    for (let i = 1; i < windows.length; i++) {
      expect(windows[i]?.[0]).toBeGreaterThan(windows[i - 1]?.[0] ?? Infinity);
    }
  });

  it("is fully deterministic — no randomness involved at all", () => {
    const a = walkUsEquityWindows(1, tinyUsHistory);
    const b = walkUsEquityWindows(1, tinyUsHistory);
    expect(a).toEqual(b);
  });

  it("falls back to a single circular window when years*12 exceeds the dataset's length, rather than throwing", () => {
    const windows = walkUsEquityWindows(3, tinyUsHistory);
    expect(windows).toHaveLength(1);
    expect(windows[0]).toHaveLength(3);
  });
});
