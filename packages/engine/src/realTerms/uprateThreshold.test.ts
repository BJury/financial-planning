import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { uprateThreshold, type UpratingPolicy } from "./uprateThreshold.js";

const baseValue = poundsToPence(12570);
const inflationRate = 0.025;

describe("uprateThreshold — inflationLinked", () => {
  const policy: UpratingPolicy = { kind: "inflationLinked" };

  it("stays exactly flat in real terms regardless of years elapsed", () => {
    expect(uprateThreshold(baseValue, policy, inflationRate, 1)).toBe(baseValue);
    expect(uprateThreshold(baseValue, policy, inflationRate, 10)).toBe(baseValue);
    expect(uprateThreshold(baseValue, policy, inflationRate, 50)).toBe(baseValue);
  });

  it("stays flat even at a very high inflation rate", () => {
    expect(uprateThreshold(baseValue, policy, 0.5, 20)).toBe(baseValue);
  });
});

describe("uprateThreshold — frozenNominal", () => {
  const policy: UpratingPolicy = { kind: "frozenNominal" };

  it("erodes in real terms year over year when inflation is positive", () => {
    const afterOneYear = uprateThreshold(baseValue, policy, inflationRate, 1);
    const afterTwoYears = uprateThreshold(baseValue, policy, inflationRate, 2);
    const afterTenYears = uprateThreshold(baseValue, policy, inflationRate, 10);

    expect(afterOneYear).toBeLessThan(baseValue);
    expect(afterTwoYears).toBeLessThan(afterOneYear);
    expect(afterTenYears).toBeLessThan(afterTwoYears);
  });

  it("matches the expected compounding: real value = base / (1+inflation)^years", () => {
    // 1 year at 2.5% inflation: 12570 / 1.025 ≈ 12263.41 -> rounds to 12263.41 in pounds
    const afterOneYear = uprateThreshold(baseValue, policy, inflationRate, 1);
    const expectedPounds = 12570 / 1.025;
    expect(afterOneYear).toBe(poundsToPence(Math.round(expectedPounds * 100) / 100));
  });

  it("stays exactly flat when inflation is zero", () => {
    expect(uprateThreshold(baseValue, policy, 0, 15)).toBe(baseValue);
  });
});

describe("uprateThreshold — customRate", () => {
  it("grows in real terms when the custom nominal rate exceeds inflation", () => {
    const policy: UpratingPolicy = { kind: "customRate", nominalRate: 0.06 };
    const result = uprateThreshold(baseValue, policy, inflationRate, 5);
    expect(result).toBeGreaterThan(baseValue);
  });

  it("shrinks in real terms when the custom nominal rate is below inflation", () => {
    const policy: UpratingPolicy = { kind: "customRate", nominalRate: 0.01 };
    const result = uprateThreshold(baseValue, policy, inflationRate, 5);
    expect(result).toBeLessThan(baseValue);
  });

  it("behaves identically to inflationLinked when the custom rate equals inflation", () => {
    const policy: UpratingPolicy = { kind: "customRate", nominalRate: inflationRate };
    const result = uprateThreshold(baseValue, policy, inflationRate, 7);
    expect(result).toBe(baseValue);
  });

  it("behaves identically to frozenNominal when the custom rate is zero", () => {
    const customPolicy: UpratingPolicy = { kind: "customRate", nominalRate: 0 };
    const frozenPolicy: UpratingPolicy = { kind: "frozenNominal" };
    expect(uprateThreshold(baseValue, customPolicy, inflationRate, 8)).toBe(
      uprateThreshold(baseValue, frozenPolicy, inflationRate, 8),
    );
  });
});

describe("uprateThreshold — zero or negative years elapsed", () => {
  it("returns the base value unchanged for zero years elapsed, for every policy", () => {
    const policies: UpratingPolicy[] = [
      { kind: "inflationLinked" },
      { kind: "frozenNominal" },
      { kind: "customRate", nominalRate: 0.05 },
    ];
    for (const policy of policies) {
      expect(uprateThreshold(baseValue, policy, inflationRate, 0)).toBe(baseValue);
    }
  });
});
