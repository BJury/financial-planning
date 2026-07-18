import { describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateToLatest, SchemaMigrationError } from "./index.js";

describe("migrateToLatest", () => {
  it("passes through a value already at the current schema version", () => {
    const data = { schemaVersion: CURRENT_SCHEMA_VERSION, household: { people: [] } };
    expect(migrateToLatest(data)).toBe(data);
  });

  it("rejects a schema version newer than this build supports", () => {
    const data = { schemaVersion: CURRENT_SCHEMA_VERSION + 1 };
    expect(() => migrateToLatest(data)).toThrow(SchemaMigrationError);
    try {
      migrateToLatest(data);
    } catch (error) {
      expect(error).toBeInstanceOf(SchemaMigrationError);
      expect((error as SchemaMigrationError).code).toBe("TOO_NEW");
    }
  });

  it("rejects a value with no recognisable schemaVersion", () => {
    expect(() => migrateToLatest({ foo: "bar" })).toThrow(SchemaMigrationError);
    expect(() => migrateToLatest(null)).toThrow(SchemaMigrationError);
    expect(() => migrateToLatest("not an object")).toThrow(SchemaMigrationError);
    expect(() => migrateToLatest({ schemaVersion: "not a number" })).toThrow(SchemaMigrationError);
  });

  it("tags unrecognised-shape errors with the UNRECOGNISED code", () => {
    try {
      migrateToLatest({ foo: "bar" });
    } catch (error) {
      expect((error as SchemaMigrationError).code).toBe("UNRECOGNISED");
    }
  });
});
