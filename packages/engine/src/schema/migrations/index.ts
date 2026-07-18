import type { Scenario } from "../types.js";

export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Migrates an arbitrary decoded value (from IndexedDB or an imported
 * file) up to the current schema version (SPEC.md §9.2). Currently a
 * no-op beyond validating shape, since schema version 1 is the only
 * version that has ever existed — this is the extension point future
 * versions attach to: each version bump adds one small, pure,
 * independently-tested `vNToVN+1` function (e.g. `v1ToV2.ts`) and one
 * more `case` here, never a rewrite of this function itself.
 *
 * Throws (rather than guessing) for:
 * - a schema version newer than this build knows about (SPEC.md §9.2:
 *   "refuse the import... rather than attempting a lossy read")
 * - a value that doesn't even have a recognisable `schemaVersion`
 */
export function migrateToLatest(data: unknown): Scenario {
  if (typeof data !== "object" || data === null || !("schemaVersion" in data)) {
    throw new SchemaMigrationError("UNRECOGNISED", "This file isn't a recognised Scenario export.");
  }

  const { schemaVersion } = data;
  if (typeof schemaVersion !== "number") {
    throw new SchemaMigrationError("UNRECOGNISED", "This file isn't a recognised Scenario export.");
  }

  if (schemaVersion > CURRENT_SCHEMA_VERSION) {
    throw new SchemaMigrationError(
      "TOO_NEW",
      "This file was created by a newer version of the app — refresh to update, then try again.",
    );
  }

  // schemaVersion === CURRENT_SCHEMA_VERSION (1): no migration needed.
  // schemaVersion < CURRENT_SCHEMA_VERSION: would run v1ToV2(), v2ToV3()
  // etc. here in sequence once they exist.
  return data as Scenario;
}

export class SchemaMigrationError extends Error {
  readonly code: "UNRECOGNISED" | "TOO_NEW";

  constructor(code: "UNRECOGNISED" | "TOO_NEW", message: string) {
    super(message);
    this.code = code;
    this.name = "SchemaMigrationError";
  }
}
