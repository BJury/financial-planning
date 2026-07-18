import { describe, expect, it } from "vitest";
import { poundsToPence } from "../money/pence.js";
import { applyPrivateResidenceRelief } from "./privateResidenceRelief.js";

describe("applyPrivateResidenceRelief", () => {
  it("fully exempts a main residence's gain from CGT", () => {
    expect(applyPrivateResidenceRelief(poundsToPence(250_000))).toBe(poundsToPence(0));
  });

  it("exempts even a very large gain", () => {
    expect(applyPrivateResidenceRelief(poundsToPence(2_000_000))).toBe(poundsToPence(0));
  });
});
