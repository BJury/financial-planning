import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import { applySalarySacrifice } from "./salarySacrifice.js";

describe("applySalarySacrifice", () => {
  it("reduces income by the full sacrifice amount", () => {
    expect(applySalarySacrifice(poundsToPence(50000), poundsToPence(5000))).toBe(poundsToPence(45000));
  });

  it("is a no-op for a zero sacrifice", () => {
    expect(applySalarySacrifice(poundsToPence(50000), pence(0))).toBe(poundsToPence(50000));
  });

  it("is used for both taxable income and NIable income by the caller — this function itself is base-agnostic", () => {
    // Documents the design: applySalarySacrifice is called twice by
    // runProjection (once against taxable income, once against NIable
    // income) rather than being NI-aware itself (SPEC.md §9.3).
    const taxableBase = poundsToPence(50000);
    const niableBase = poundsToPence(50000);
    const sacrifice = poundsToPence(5000);
    expect(applySalarySacrifice(taxableBase, sacrifice)).toBe(applySalarySacrifice(niableBase, sacrifice));
  });
});
