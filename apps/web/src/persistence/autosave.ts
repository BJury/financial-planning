import { CURRENT_SCHEMA_VERSION, migrateToLatest, type Scenario } from "@fp/engine";
import { useScenarioStore } from "../state/store.js";
import { db } from "./db.js";

/**
 * Phase 1 keeps exactly one Scenario under a fixed id — the "list of
 * Scenarios, in-app switcher" (SPEC.md §8, §9.2) is a later-phase UI
 * feature on top of the same Dexie table, not a change to persistence
 * itself.
 */
const CURRENT_SCENARIO_ID = "current";

const AUTOSAVE_DEBOUNCE_MS = 400;

let saveTimeout: ReturnType<typeof setTimeout> | undefined;

/** Debounced write-through to IndexedDB (SPEC.md §9.2) — call on every Scenario change. */
export function scheduleAutosave(scenario: Scenario): void {
  if (saveTimeout !== undefined) {
    clearTimeout(saveTimeout);
  }
  saveTimeout = setTimeout(() => {
    void db.scenarios.put({
      id: CURRENT_SCENARIO_ID,
      name: "My plan",
      schemaVersion: CURRENT_SCHEMA_VERSION,
      data: scenario,
      updatedAt: new Date().toISOString(),
    });
  }, AUTOSAVE_DEBOUNCE_MS);
}

/**
 * Loads the saved Scenario on app start, if one exists (SPEC.md §4
 * journey 1: a returning visit resumes exactly where the user left off).
 * Returns `null` for a genuine first-time visit — the caller falls back
 * to onboarding.
 */
export async function loadSavedScenario(): Promise<Scenario | null> {
  const row = await db.scenarios.get(CURRENT_SCENARIO_ID);
  if (!row) {
    return null;
  }
  return migrateToLatest(row.data);
}

/** Wires the store's Scenario changes to the debounced autosave writer. Call once, at app start. */
export function subscribeAutosave(): () => void {
  return useScenarioStore.subscribe((state, previousState) => {
    if (state.scenario && state.scenario !== previousState.scenario) {
      scheduleAutosave(state.scenario);
    }
  });
}
