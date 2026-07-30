import { describe, expect, it } from "vitest";
import { migrateToLatest } from "./index.js";
import { v1ToV2 } from "./v1ToV2.js";

describe("v1ToV2", () => {
  it("splits an old-shape assetAllocation's equities fraction 50/50 into usEquities/ukEquities", () => {
    const result = v1ToV2({
      schemaVersion: 1,
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { equities: 0.6, bonds: 0.3, cash: 0.1 } }],
    });
    expect(result["accounts"]).toEqual([
      { id: "a1", kind: "isa", assetAllocation: { usEquities: 0.3, ukEquities: 0.3, bonds: 0.3, cash: 0.1 } },
    ]);
    expect(result["schemaVersion"]).toBe(2);
  });

  it("leaves an account with no assetAllocation untouched", () => {
    const result = v1ToV2({ schemaVersion: 1, accounts: [{ id: "a1", kind: "cash" }] });
    expect(result["accounts"]).toEqual([{ id: "a1", kind: "cash" }]);
  });

  it("leaves an account whose assetAllocation is already the new shape untouched", () => {
    const newShape = { usEquities: 0.2, ukEquities: 0.2, bonds: 0.4, cash: 0.2 };
    const result = v1ToV2({ schemaVersion: 1, accounts: [{ id: "a1", kind: "isa", assetAllocation: newShape }] });
    expect(result["accounts"]).toEqual([{ id: "a1", kind: "isa", assetAllocation: newShape }]);
  });

  it("handles a scenario with no accounts array gracefully", () => {
    const result = v1ToV2({ schemaVersion: 1, household: { people: [] } });
    expect(result["schemaVersion"]).toBe(2);
  });

  it("participates in migrateToLatest's full chain for a schemaVersion 1 scenario (v1 -> v2 -> v3)", () => {
    // v1's 0.8 equities splits 50/50 here (v1ToV2), then v2ToV3 sums the halves straight back to
    // 0.8 and picks "uk" on the resulting tie — see v2ToV3.test.ts for that step in isolation.
    const result = migrateToLatest({
      schemaVersion: 1,
      household: { people: [] },
      accounts: [{ id: "a1", kind: "isa", assetAllocation: { equities: 0.8, bonds: 0.1, cash: 0.1 } }],
    });
    expect((result as unknown as { readonly [key: string]: unknown })["schemaVersion"]).toBe(3);
    expect(result.accounts).toEqual([
      { id: "a1", kind: "isa", assetAllocation: { equities: 0.8, equityMarket: "uk", bonds: 0.1, cash: 0.1 } },
    ]);
  });
});
