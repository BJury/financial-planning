import { describe, expect, it } from "vitest";
import {
  addPence,
  isNegative,
  maxPence,
  minPence,
  multiplyPenceByRate,
  pence,
  penceToPounds,
  poundsToPence,
  subtractPence,
  sumPence,
  zeroPence,
} from "./pence.js";

describe("pence", () => {
  it("accepts finite integers", () => {
    expect(pence(0)).toBe(0);
    expect(pence(-500)).toBe(-500);
  });

  it("rejects non-integer values", () => {
    expect(() => pence(1.5)).toThrow(/integer/);
  });

  it("rejects non-finite values", () => {
    expect(() => pence(Number.NaN)).toThrow();
    expect(() => pence(Number.POSITIVE_INFINITY)).toThrow();
  });

  it("zeroPence is 0", () => {
    expect(zeroPence()).toBe(0);
  });
});

describe("poundsToPence / penceToPounds", () => {
  it("round-trips whole pounds", () => {
    expect(poundsToPence(100)).toBe(10000);
    expect(penceToPounds(pence(10000))).toBe(100);
  });

  it("round-trips exact pence amounts", () => {
    expect(poundsToPence(12570.5)).toBe(1257050);
  });

  it("rounds sub-penny pounds inputs to the nearest penny", () => {
    // £0.005 = 0.5p -> rounds to 1p (round-half-away-from-zero, §9.6)
    expect(poundsToPence(0.005)).toBe(1);
    // A value that would otherwise drift under naive float multiplication
    expect(poundsToPence(19.99)).toBe(1999);
  });

  it("handles negative pounds", () => {
    expect(poundsToPence(-50)).toBe(-5000);
  });
});

describe("arithmetic", () => {
  it("adds and subtracts", () => {
    expect(addPence(pence(100), pence(50))).toBe(150);
    expect(subtractPence(pence(100), pence(150))).toBe(-50);
  });

  it("sums an array, including an empty array", () => {
    expect(sumPence([pence(100), pence(200), pence(-50)])).toBe(250);
    expect(sumPence([])).toBe(0);
  });

  it("min/max", () => {
    expect(maxPence(pence(100), pence(200))).toBe(200);
    expect(minPence(pence(100), pence(200))).toBe(100);
  });

  it("isNegative", () => {
    expect(isNegative(pence(-1))).toBe(true);
    expect(isNegative(pence(0))).toBe(false);
    expect(isNegative(pence(1))).toBe(false);
  });
});

describe("multiplyPenceByRate", () => {
  it("applies a rate at full precision and rounds only the monetary result (§9.6)", () => {
    // 20% of £100.00 (10000p) = 2000p exactly
    expect(multiplyPenceByRate(pence(10000), 0.2)).toBe(2000);
    // A rate that would produce a fractional penny before rounding
    // 8% of £123.45 (12345p) = 987.6p -> rounds to 988p
    expect(multiplyPenceByRate(pence(12345), 0.08)).toBe(988);
  });

  it("handles a zero rate", () => {
    expect(multiplyPenceByRate(pence(10000), 0)).toBe(0);
  });

  it("handles a rate greater than 1 (e.g. a growth multiplier)", () => {
    expect(multiplyPenceByRate(pence(10000), 1.05)).toBe(10500);
  });
});
