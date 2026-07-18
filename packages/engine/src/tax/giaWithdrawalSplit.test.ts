import { describe, expect, it } from "vitest";
import { pence, poundsToPence, zeroPence } from "../money/pence.js";
import { splitGiaWithdrawal } from "./giaWithdrawalSplit.js";

describe("splitGiaWithdrawal", () => {
  it("splits proportionally to the account's cost-basis share of its balance", () => {
    // £80,000 balance, £60,000 cost basis -> 75% return of capital, 25% gain.
    const result = splitGiaWithdrawal(poundsToPence(10000), poundsToPence(60000), poundsToPence(80000));
    expect(result.returnOfCapitalAmount).toBe(poundsToPence(7500));
    expect(result.gainAmount).toBe(poundsToPence(2500));
  });

  it("is entirely return of capital when cost basis equals the balance (no gain yet)", () => {
    const result = splitGiaWithdrawal(poundsToPence(10000), poundsToPence(80000), poundsToPence(80000));
    expect(result.returnOfCapitalAmount).toBe(poundsToPence(10000));
    expect(result.gainAmount).toBe(0);
  });

  it("is entirely return of capital (never a negative gain) when cost basis exceeds the balance, e.g. after a market fall", () => {
    const result = splitGiaWithdrawal(poundsToPence(10000), poundsToPence(90000), poundsToPence(80000));
    expect(result.returnOfCapitalAmount).toBe(poundsToPence(10000));
    expect(result.gainAmount).toBe(0);
  });

  it("is entirely gain when the cost basis is zero", () => {
    const result = splitGiaWithdrawal(poundsToPence(10000), zeroPence(), poundsToPence(80000));
    expect(result.returnOfCapitalAmount).toBe(0);
    expect(result.gainAmount).toBe(poundsToPence(10000));
  });

  it("handles a zero withdrawal without error", () => {
    const result = splitGiaWithdrawal(zeroPence(), poundsToPence(60000), poundsToPence(80000));
    expect(result.returnOfCapitalAmount).toBe(0);
    expect(result.gainAmount).toBe(0);
  });

  it("the two portions always sum back to the gross amount", () => {
    for (const [gross, basis, balance] of [
      [poundsToPence(5000), poundsToPence(1000), poundsToPence(10000)],
      [poundsToPence(3333), poundsToPence(6789), poundsToPence(12345)],
    ] as const) {
      const result = splitGiaWithdrawal(gross, basis, balance);
      expect(pence(result.returnOfCapitalAmount + result.gainAmount)).toBe(gross);
    }
  });
});
