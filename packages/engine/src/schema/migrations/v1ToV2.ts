/**
 * v1 -> v2: `Account.assetAllocation` gained a UK/US equities split
 * (`{ equities, bonds, cash }` -> `{ usEquities, ukEquities, bonds, cash }`,
 * `schema/types.ts`'s `AssetAllocation`), so the historical-bootstrap
 * dataset behind it could track two genuinely distinct real markets
 * instead of one blended "equities" figure. Any account that already had
 * an explicit `assetAllocation` (set via the Confidence page) has its old
 * `equities` fraction split 50/50 into `usEquities`/`ukEquities` — the same
 * default split `RISK_PROFILE_PRESETS` uses, so a migrated custom
 * allocation lands on the same assumption a fresh one would. Accounts with
 * no `assetAllocation` at all are untouched — they already fall back to
 * `DEFAULT_ASSET_ALLOCATION` wherever it's read, unaffected by this shape
 * change.
 *
 * Operates on `unknown`/loosely-shaped input, not the current `Scenario`
 * type — the whole point of a migration is reading data that predates
 * (and doesn't typecheck against) today's types.
 */
export function v1ToV2(data: { readonly [key: string]: unknown }): { readonly [key: string]: unknown } {
  const accounts = data["accounts"];
  if (!Array.isArray(accounts)) return { ...data, schemaVersion: 2 };

  return {
    ...data,
    schemaVersion: 2,
    accounts: accounts.map((account: unknown) => {
      if (typeof account !== "object" || account === null) return account;
      const allocation = (account as { readonly [key: string]: unknown })["assetAllocation"];
      if (typeof allocation !== "object" || allocation === null || !("equities" in allocation)) return account;

      const { equities, bonds, cash } = allocation as { readonly equities: number; readonly bonds: number; readonly cash: number };
      return {
        ...account,
        assetAllocation: { usEquities: equities / 2, ukEquities: equities / 2, bonds, cash },
      };
    }),
  };
}
