import { describe, expect, it } from "vitest";
import { pence, poundsToPence } from "../../money/pence.js";
import {
  applyAnnualAllowanceCarryForward,
  emptyCarryForwardWindow,
  type AnnualAllowanceCarryForwardInput,
} from "./annualAllowanceCarryForward.js";

describe("applyAnnualAllowanceCarryForward", () => {
  it("has no excess when the contribution is within the current year's own allowance", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(40000),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: emptyCarryForwardWindow(),
    };
    const result = applyAnnualAllowanceCarryForward(input);
    expect(result.excessContribution).toBe(0);
  });

  it("carries forward the unused amount when under the current year's allowance", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(40000),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: emptyCarryForwardWindow(),
    };
    const result = applyAnnualAllowanceCarryForward(input);
    // £20,000 unused this year rolls forward as the newest (last) entry.
    expect(result.nextUnusedAllowanceByPreviousThreeYears.at(-1)).toBe(poundsToPence(20000));
  });

  it("flags an excess when the contribution exceeds current-year allowance with no carry-forward available", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(80000),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: emptyCarryForwardWindow(),
    };
    const result = applyAnnualAllowanceCarryForward(input);
    expect(result.excessContribution).toBe(poundsToPence(20000));
  });

  it("consumes carried-forward allowance, oldest first, before flagging an excess", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(90000),
      currentYearAllowance: poundsToPence(60000),
      // 3 years ago: £10k unused; 2 years ago: £5k unused; last year: £0 unused.
      unusedAllowanceByPreviousThreeYears: [poundsToPence(10000), poundsToPence(5000), pence(0)],
    };
    const result = applyAnnualAllowanceCarryForward(input);
    // £90k contribution - £60k current year = £30k over; £10k + £5k carry-forward covers £15k, leaving £15k excess.
    expect(result.excessContribution).toBe(poundsToPence(15000));
    // Both carried-forward years should now be fully consumed (zero).
    expect(result.nextUnusedAllowanceByPreviousThreeYears[0]).toBe(0); // was 2 years ago's slot, now the oldest retained
    expect(result.nextUnusedAllowanceByPreviousThreeYears[1]).toBe(0); // was last year's slot (already 0)
  });

  it("rolls the 3-year window forward, dropping the oldest year and appending this year's unused amount", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(30000),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: [poundsToPence(1000), poundsToPence(2000), poundsToPence(3000)],
    };
    const result = applyAnnualAllowanceCarryForward(input);
    // The oldest (£1,000) is dropped; £2,000 and £3,000 shift down; this
    // year's £30,000 unused (60,000 - 30,000) is appended as the newest.
    expect(result.nextUnusedAllowanceByPreviousThreeYears).toEqual([
      poundsToPence(2000),
      poundsToPence(3000),
      poundsToPence(30000),
    ]);
  });

  it("never returns more than 3 entries in the rolled-forward window", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: pence(0),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: [poundsToPence(1000), poundsToPence(2000), poundsToPence(3000)],
    };
    const result = applyAnnualAllowanceCarryForward(input);
    expect(result.nextUnusedAllowanceByPreviousThreeYears).toHaveLength(3);
  });

  it("handles a genuinely fresh start (no prior simulated history) without error", () => {
    const input: AnnualAllowanceCarryForwardInput = {
      totalContribution: poundsToPence(50000),
      currentYearAllowance: poundsToPence(60000),
      unusedAllowanceByPreviousThreeYears: emptyCarryForwardWindow(),
    };
    expect(() => applyAnnualAllowanceCarryForward(input)).not.toThrow();
  });
});
