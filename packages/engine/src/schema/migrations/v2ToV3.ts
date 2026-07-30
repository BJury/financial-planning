/**
 * v2 -> v3: `Account.assetAllocation` dropped the two-number US/UK equity
 * split (`{ usEquities, ukEquities, bonds, cash }`) in favour of one
 * `equities` fraction plus a single either/or `equityMarket: "us" | "uk"`
 * choice (`schema/types.ts`'s `AssetAllocation`) — a v2-era account could
 * only reach that split via a 50/50 preset or its own explicit custom
 * entry, and product feedback was that a single "which market" choice per
 * account is simpler and matches how most real accounts are actually
 * invested (e.g. "this SIPP tracks the S&P 500"), at the cost of no
 * longer being able to blend both markets within one account (use two
 * accounts for that instead).
 *
 * `equities` becomes the sum of the two old fractions (preserving total
 * equity weight); `equityMarket` picks whichever of the two was larger,
 * defaulting to `"uk"` on an exact tie (this is a UK retirement planner).
 * Any genuine mix an old account had (rather than 100% one market) is
 * necessarily approximated by this collapse — an unavoidable, disclosed
 * consequence of the simplification, not a bug.
 *
 * Operates on `unknown`/loosely-shaped input, not the current `Scenario`
 * type — the whole point of a migration is reading data that predates
 * (and doesn't typecheck against) today's types.
 */
export function v2ToV3(data: { readonly [key: string]: unknown }): { readonly [key: string]: unknown } {
  const accounts = data["accounts"];
  if (!Array.isArray(accounts)) return { ...data, schemaVersion: 3 };

  return {
    ...data,
    schemaVersion: 3,
    accounts: accounts.map((account: unknown) => {
      if (typeof account !== "object" || account === null) return account;
      const allocation = (account as { readonly [key: string]: unknown })["assetAllocation"];
      if (typeof allocation !== "object" || allocation === null || !("usEquities" in allocation)) return account;

      const { usEquities, ukEquities, bonds, cash } = allocation as {
        readonly usEquities: number;
        readonly ukEquities: number;
        readonly bonds: number;
        readonly cash: number;
      };
      return {
        ...account,
        assetAllocation: { equities: usEquities + ukEquities, equityMarket: ukEquities >= usEquities ? "uk" : "us", bonds, cash },
      };
    }),
  };
}
