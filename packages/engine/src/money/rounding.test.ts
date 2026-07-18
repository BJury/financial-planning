import { describe, expect, it } from "vitest";
import { roundHalfAwayFromZero } from "./rounding.js";

describe("roundHalfAwayFromZero", () => {
  it("rounds positive values half up", () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(1.4)).toBe(1);
    expect(roundHalfAwayFromZero(1.5)).toBe(2);
    expect(roundHalfAwayFromZero(1.6)).toBe(2);
  });

  it("rounds negative values half away from zero, symmetrically with positives", () => {
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(-1.4)).toBe(-1);
    expect(roundHalfAwayFromZero(-1.5)).toBe(-2);
    expect(roundHalfAwayFromZero(-1.6)).toBe(-2);
  });

  it("leaves whole numbers unchanged", () => {
    expect(roundHalfAwayFromZero(0)).toBe(0);
    expect(roundHalfAwayFromZero(5)).toBe(5);
    expect(roundHalfAwayFromZero(-5)).toBe(-5);
  });

  it("never produces negative zero", () => {
    expect(Object.is(roundHalfAwayFromZero(-0.1), -0)).toBe(false);
    expect(Object.is(roundHalfAwayFromZero(-0.1), 0)).toBe(true);
  });

  it("is symmetric: rounding -x has the same magnitude as rounding x", () => {
    // Values chosen away from the x=0.1-style case where both x and -x
    // round to (normalised, non-negative) zero — that case is already
    // covered explicitly above and isn't a meaningful symmetry check.
    for (const x of [0.49, 0.5, 0.51, 12.345, 99.995]) {
      expect(Math.abs(roundHalfAwayFromZero(-x))).toBe(Math.abs(roundHalfAwayFromZero(x)));
    }
  });
});
