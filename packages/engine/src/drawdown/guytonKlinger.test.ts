import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { applyGuytonKlinger, type DrawdownGuardrailPolicy } from "./guytonKlinger.js";

const POLICY: DrawdownGuardrailPolicy = { cutTriggerPct: 0.2, cutAmountPct: 0.1, raiseTriggerPct: 0.2, raiseAmountPct: 0.1 };

describe("applyGuytonKlinger", () => {
  it("establishes the baseline on the first active year without nudging the target", () => {
    const result = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1000000), zeroPence(), POLICY);
    expect(result.rawTarget).toBe(poundsToPence(50000));
    expect(result.event).toBe("none");
    expect(result.nextState.baselineRate).toBeCloseTo(0.05, 6);
    expect(result.nextState.carriedTarget).toBe(poundsToPence(50000));
  });

  it("cuts the target when the pool has shrunk enough to push the current rate more than cutTriggerPct above baseline", () => {
    const prior = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1000000), zeroPence(), POLICY).nextState;
    // Pool drops to £700,000: rate goes from 5% to ~7.14%, well past the 20%-above-baseline (6%) trigger.
    const result = applyGuytonKlinger(prior, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(700000), zeroPence(), POLICY);
    expect(result.event).toBe("cut");
    expect(result.rawTarget).toBe(poundsToPence(45000));
    expect(result.nextState.baselineRate).toBeCloseTo(0.05, 6);
  });

  it("raises the target when the pool has grown enough to push the current rate more than raiseTriggerPct below baseline", () => {
    const prior = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1000000), zeroPence(), POLICY).nextState;
    // Pool grows to £1,500,000: rate goes from 5% to ~3.33%, well past the 20%-below-baseline (4%) trigger.
    const result = applyGuytonKlinger(prior, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1500000), zeroPence(), POLICY);
    expect(result.event).toBe("raise");
    expect(result.rawTarget).toBe(poundsToPence(55000));
  });

  it("leaves the target unchanged when the pool moves only slightly", () => {
    const prior = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1000000), zeroPence(), POLICY).nextState;
    // Pool at £1,020,000: rate ~4.9%, within both triggers of the 5% baseline.
    const result = applyGuytonKlinger(prior, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1020000), zeroPence(), POLICY);
    expect(result.event).toBe("none");
    expect(result.rawTarget).toBe(poundsToPence(50000));
  });

  it("nets off other automatic income before computing the rate, both at baseline and in later years", () => {
    // £80,000 target, £30,000 already coming from elsewhere -> £50,000 actually drawn, same 5% rate as the tests above.
    const prior = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(80000) }, poundsToPence(1000000), poundsToPence(30000), POLICY).nextState;
    expect(prior.baselineRate).toBeCloseTo(0.05, 6);
    const result = applyGuytonKlinger(prior, { targetNetAnnualIncome: poundsToPence(80000) }, poundsToPence(700000), poundsToPence(30000), POLICY);
    expect(result.event).toBe("cut");
  });

  it("carries the nudged target forward across repeated cuts, each measured against the same original baseline", () => {
    let state = applyGuytonKlinger(undefined, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(1000000), zeroPence(), POLICY).nextState;
    const firstCut = applyGuytonKlinger(state, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(700000), zeroPence(), POLICY);
    expect(firstCut.rawTarget).toBe(poundsToPence(45000));
    state = firstCut.nextState;
    // Pool stays depressed: a second cut nudges further down from the already-cut £45,000, not back from £50,000.
    const secondCut = applyGuytonKlinger(state, { targetNetAnnualIncome: poundsToPence(50000) }, poundsToPence(700000), zeroPence(), POLICY);
    expect(secondCut.event).toBe("cut");
    expect(secondCut.rawTarget).toBe(poundsToPence(40500));
    expect(secondCut.nextState.baselineRate).toBeCloseTo(0.05, 6);
  });
});
