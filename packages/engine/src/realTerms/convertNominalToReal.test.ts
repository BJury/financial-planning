import { describe, expect, it } from "vitest";
import { convertNominalToReal } from "./convertNominalToReal.js";

describe("convertNominalToReal", () => {
  it("returns zero real growth when nominal growth equals inflation", () => {
    expect(convertNominalToReal(0.025, 0.025)).toBeCloseTo(0, 10);
    expect(convertNominalToReal(0.06, 0.06)).toBeCloseTo(0, 10);
  });

  it("returns zero real growth when both nominal and inflation are zero", () => {
    expect(convertNominalToReal(0, 0)).toBe(0);
  });

  it("matches the Fisher equation, not the crude subtraction approximation", () => {
    // nominal 6%, inflation 2.5% -> real = 1.06 / 1.025 - 1 ≈ 3.4146%
    // The crude approximation (6% - 2.5% = 3.5%) is close but NOT exact —
    // this test would still pass against the crude approximation at this
    // low a rate, so the point is made properly by the higher-rate case below.
    expect(convertNominalToReal(0.06, 0.025)).toBeCloseTo(0.034146, 6);
  });

  it("diverges visibly from the crude subtraction approximation at higher rates", () => {
    // nominal 20%, inflation 10%: Fisher = 1.2/1.1 - 1 ≈ 9.09%, crude = 10%.
    const fisher = convertNominalToReal(0.2, 0.1);
    const crudeApproximation = 0.2 - 0.1;
    expect(fisher).toBeCloseTo(0.090909, 5);
    expect(Math.abs(fisher - crudeApproximation)).toBeGreaterThan(0.005);
  });

  it("handles a negative nominal rate (a loss)", () => {
    expect(convertNominalToReal(-0.05, 0.025)).toBeCloseTo(-0.07317, 5);
  });

  it("handles zero inflation (real equals nominal)", () => {
    expect(convertNominalToReal(0.06, 0)).toBeCloseTo(0.06, 10);
  });
});
