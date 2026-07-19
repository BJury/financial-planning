import { describe, expect, it } from "vitest";
import { isWithinActiveDateRange } from "./activeDateRange.js";

describe("isWithinActiveDateRange", () => {
  it("is always active when neither bound is set", () => {
    expect(isWithinActiveDateRange(undefined, undefined, 2026)).toBe(true);
    expect(isWithinActiveDateRange(undefined, undefined, 2099)).toBe(true);
  });

  it("is inactive before the start date's year", () => {
    expect(isWithinActiveDateRange("2031-04-06", undefined, 2030)).toBe(false);
    expect(isWithinActiveDateRange("2031-04-06", undefined, 2031)).toBe(true);
    expect(isWithinActiveDateRange("2031-04-06", undefined, 2040)).toBe(true);
  });

  it("is inactive after the end date's year", () => {
    expect(isWithinActiveDateRange(undefined, "2040-12-31", 2040)).toBe(true);
    expect(isWithinActiveDateRange(undefined, "2040-12-31", 2041)).toBe(false);
  });

  it("supports a bounded range on both ends — e.g. a 10-year rental starting in 5 years", () => {
    // Scenario starts 2026; rental starts 2031, runs for 10 years (2031-2040 inclusive).
    expect(isWithinActiveDateRange("2031-01-01", "2040-12-31", 2026)).toBe(false);
    expect(isWithinActiveDateRange("2031-01-01", "2040-12-31", 2031)).toBe(true);
    expect(isWithinActiveDateRange("2031-01-01", "2040-12-31", 2040)).toBe(true);
    expect(isWithinActiveDateRange("2031-01-01", "2040-12-31", 2041)).toBe(false);
  });

  it("treats an unparseable bound as not-yet-active, never as unrestricted — a required date field left at its default empty string must not become active every year", () => {
    // The real bug this guards: NaN comparisons are always false in JS, so
    // an unguarded `calendarYear < NaN` / `calendarYear > NaN` both
    // silently pass, making an incomplete date range match *every* year
    // instead of none.
    expect(isWithinActiveDateRange("", undefined, 2026)).toBe(false);
    expect(isWithinActiveDateRange("", undefined, 2099)).toBe(false);
    expect(isWithinActiveDateRange(undefined, "", 2026)).toBe(false);
    expect(isWithinActiveDateRange("", "", 2026)).toBe(false);
    expect(isWithinActiveDateRange("not-a-date", undefined, 2026)).toBe(false);
  });
});
