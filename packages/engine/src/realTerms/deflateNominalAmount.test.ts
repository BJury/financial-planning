import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { deflateNominalAmount } from "./deflateNominalAmount.js";

describe("deflateNominalAmount", () => {
  it("returns the amount unchanged at year 0 (no inflation has elapsed yet)", () => {
    expect(deflateNominalAmount(poundsToPence(1000), 0.025, 0)).toBe(poundsToPence(1000));
  });

  it("shrinks a flat nominal amount's real value over time at 2.5% inflation", () => {
    // £1,000 nominal in a year's time is worth £1,000 / 1.025 = £975.61 today.
    expect(deflateNominalAmount(poundsToPence(1000), 0.025, 1)).toBe(poundsToPence(975.61));
  });

  it("compounds the deflation over multiple years", () => {
    // £1,000 nominal in 10 years' time at 2.5% inflation, deflated to today: £1,000 / 1.025^10.
    const expected = Math.round((1000 / Math.pow(1.025, 10)) * 100);
    expect(deflateNominalAmount(poundsToPence(1000), 0.025, 10)).toBe(expected);
  });

  it("leaves the amount unchanged with zero inflation", () => {
    expect(deflateNominalAmount(poundsToPence(1000), 0, 5)).toBe(poundsToPence(1000));
  });
});
