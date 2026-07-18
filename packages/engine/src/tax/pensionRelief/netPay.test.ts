import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { applyNetPayRelief } from "./netPay.js";

describe("applyNetPayRelief", () => {
  it("reduces taxable income by the full contribution amount", () => {
    expect(applyNetPayRelief(poundsToPence(50000), poundsToPence(5000))).toBe(poundsToPence(45000));
  });

  it("is a no-op for a zero contribution", () => {
    expect(applyNetPayRelief(poundsToPence(50000), pence(0))).toBe(poundsToPence(50000));
  });
});
