import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { adjustDrawdownTargetForAutomaticIncome } from "./adjustDrawdownTargetForAutomaticIncome.js";

describe("adjustDrawdownTargetForAutomaticIncome", () => {
  it("subtracts other net income from the target — the user's own worked example: £30,000 salary, £50,000 target, £20,000 remaining", () => {
    expect(adjustDrawdownTargetForAutomaticIncome(poundsToPence(50000), poundsToPence(30000))).toBe(poundsToPence(20000));
  });

  it("returns the full target unchanged when there's no other income at all", () => {
    expect(adjustDrawdownTargetForAutomaticIncome(poundsToPence(50000), zeroPence())).toBe(poundsToPence(50000));
  });

  it("never goes negative when other income already meets or exceeds the target", () => {
    expect(adjustDrawdownTargetForAutomaticIncome(poundsToPence(20000), poundsToPence(20000))).toBe(zeroPence());
    expect(adjustDrawdownTargetForAutomaticIncome(poundsToPence(20000), poundsToPence(35000))).toBe(zeroPence());
  });
});
