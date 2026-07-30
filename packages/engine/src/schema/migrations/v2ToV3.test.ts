import { describe, expect, it } from "vitest";
import { migrateToLatest } from "./index.js";
import { v2ToV3 } from "./v2ToV3.js";

describe("v2ToV3", () => {
  it("sums usEquities+ukEquities into equities, and picks the larger market (uk wins ties)", () => {
    const result = v2ToV3({
      schemaVersion: 2,
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { usEquities: 0.2, ukEquities: 0.4, bonds: 0.3, cash: 0.1 } }],
    });
    const accounts = result["accounts"] as readonly { readonly assetAllocation: { readonly equities: number; readonly equityMarket: string; readonly bonds: number; readonly cash: number } }[];
    expect(accounts[0]?.assetAllocation.equities).toBeCloseTo(0.6, 10);
    expect(accounts[0]?.assetAllocation.equityMarket).toBe("uk");
    expect(accounts[0]?.assetAllocation.bonds).toBe(0.3);
    expect(accounts[0]?.assetAllocation.cash).toBe(0.1);
    expect(result["schemaVersion"]).toBe(3);
  });

  it("picks us when usEquities is strictly larger", () => {
    const result = v2ToV3({
      schemaVersion: 2,
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { usEquities: 0.5, ukEquities: 0.1, bonds: 0.2, cash: 0.2 } }],
    });
    expect(result["accounts"]).toEqual([
      { id: "a1", kind: "isa", assetAllocation: { equities: 0.6, equityMarket: "us", bonds: 0.2, cash: 0.2 } },
    ]);
  });

  it("defaults to uk on an exact tie", () => {
    const result = v2ToV3({
      schemaVersion: 2,
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { usEquities: 0.25, ukEquities: 0.25, bonds: 0.3, cash: 0.2 } }],
    });
    expect((result["accounts"] as readonly { readonly assetAllocation: { readonly equityMarket: string } }[])[0]?.assetAllocation.equityMarket).toBe(
      "uk",
    );
  });

  it("leaves an account with no assetAllocation untouched", () => {
    const result = v2ToV3({ schemaVersion: 2, accounts: [{ id: "a1", kind: "cash" }] });
    expect(result["accounts"]).toEqual([{ id: "a1", kind: "cash" }]);
  });

  it("leaves an account whose assetAllocation is already the new shape untouched", () => {
    const newShape = { equities: 0.6, equityMarket: "us", bonds: 0.2, cash: 0.2 };
    const result = v2ToV3({ schemaVersion: 2, accounts: [{ id: "a1", kind: "isa", assetAllocation: newShape }] });
    expect(result["accounts"]).toEqual([{ id: "a1", kind: "isa", assetAllocation: newShape }]);
  });

  it("is wired into migrateToLatest, chaining through v1 -> v2 -> v3", () => {
    const result = migrateToLatest({
      schemaVersion: 1,
      household: { people: [] },
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { equities: 0.8, bonds: 0.1, cash: 0.1 } }],
    });
    // v1's 0.8 equities splits 50/50 into usEquities/ukEquities (v1ToV2), then v2ToV3 sums them
    // back to 0.8 and picks "uk" on the resulting tie — round-trips to the same total weight.
    expect(result.accounts).toEqual([
      { id: "a1", kind: "isa", assetAllocation: { equities: 0.8, equityMarket: "uk", bonds: 0.1, cash: 0.1 } },
    ]);
  });
});
