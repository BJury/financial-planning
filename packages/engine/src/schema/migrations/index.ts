import type { Scenario } from "../types.js";
import { v1ToV2 } from "./v1ToV2.js";
import { v2ToV3 } from "./v2ToV3.js";

export const CURRENT_SCHEMA_VERSION = 3;

/**
 * Migrates an arbitrary decoded value (from IndexedDB or an imported
 * file) up to the current schema version (SPEC.md §9.2). Each version
 * bump adds one small, pure, independently-tested `vNToVN+1` function
 * (e.g. `v1ToV2.ts`) and one more step in the chain below, never a
 * rewrite of this function itself.
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

  let migrated = data as { readonly [key: string]: unknown };
  if (schemaVersion < 2) migrated = v1ToV2(migrated);
  if (schemaVersion < 3) migrated = v2ToV3(migrated);
  // schemaVersion === CURRENT_SCHEMA_VERSION (3): no further migration needed.
  // Next version bump adds `if (schemaVersion < 4) migrated = v3ToV4(migrated);` here.
  return migrated as unknown as Scenario;
}

export class SchemaMigrationError extends Error {
  readonly code: "UNRECOGNISED" | "TOO_NEW";

  constructor(code: "UNRECOGNISED" | "TOO_NEW", message: string) {
    super(message);
    this.code = code;
    this.name = "SchemaMigrationError";
  }
}
