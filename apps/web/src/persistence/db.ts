import Dexie, { type EntityTable } from "dexie";

/**
 * A single row per Scenario. Deliberately dumb (SPEC.md implementation
 * plan, risk #8): `data` is `unknown`, not a fully-typed Dexie schema —
 * both autosave-read and file-import route through the same
 * `migrateToLatest()` (@fp/engine) so there is exactly one migration
 * story, not two independently-maintained ones (Dexie's own `.version()`
 * bumps vs the Scenario file's `schemaVersion` chain).
 */
export interface ScenarioRow {
  readonly id: string;
  readonly name: string;
  readonly schemaVersion: number;
  readonly data: unknown;
  readonly updatedAt: string;
}

class AppDatabase extends Dexie {
  scenarios!: EntityTable<ScenarioRow, "id">;

  constructor() {
    super("uk-retirement-planner");
    this.version(1).stores({
      // Only `id` is indexed — everything else is read/written whole,
      // matching the "deliberately dumb" design above.
      scenarios: "id",
    });
  }
}

export const db = new AppDatabase();
