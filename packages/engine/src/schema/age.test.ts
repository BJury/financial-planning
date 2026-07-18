import { describe, expect, it } from "vitest";
import { ageAtYear } from "./age.js";

describe("ageAtYear", () => {
  it("computes age as the difference in calendar years", () => {
    expect(ageAtYear("1980-06-15", 2026)).toBe(46);
    expect(ageAtYear("2000-01-01", 2026)).toBe(26);
  });

  it("handles the birth year itself as age zero", () => {
    expect(ageAtYear("2026-03-01", 2026)).toBe(0);
  });
});
