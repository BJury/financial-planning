import { CURRENT_SCHEMA_VERSION, migrateToLatest, type Scenario } from "@fp/engine";
import { useScenarioStore } from "../state/store.js";
import { db, type ScenarioRow } from "./db.js";

const AUTOSAVE_DEBOUNCE_MS = 400;

/** One pending debounce timer per plan id, so edits to one open tab never delay or cancel another's save. */
const saveTimeouts = new Map<string, ReturnType<typeof setTimeout>>();

/** Debounced write-through to IndexedDB (SPEC.md §9.2) — call on every Scenario change, keyed by which plan changed. `order` is that plan's current tab position (see `db.ts`'s `ScenarioRow.order` doc comment). */
export function scheduleAutosave(id: string, scenario: Scenario, order: number): void {
  const existing = saveTimeouts.get(id);
  if (existing !== undefined) {
    clearTimeout(existing);
  }
  saveTimeouts.set(
    id,
    setTimeout(() => {
      saveTimeouts.delete(id);
      void db.scenarios.put({
        id,
        name: scenario.name ?? "Untitled plan",
        schemaVersion: CURRENT_SCHEMA_VERSION,
        data: scenario,
        updatedAt: new Date().toISOString(),
        order,
      });
    }, AUTOSAVE_DEBOUNCE_MS),
  );
}

/**
 * Deletes one plan's persisted row entirely — the "close tab" action's
 * IndexedDB half. Also cancels that plan's already-scheduled debounced
 * write, if any, otherwise a save queued just before closing could still
 * land *after* this delete and silently resurrect the row a moment later.
 */
export async function deletePlanRow(id: string): Promise<void> {
  const existing = saveTimeouts.get(id);
  if (existing !== undefined) {
    clearTimeout(existing);
    saveTimeouts.delete(id);
  }
  await db.scenarios.delete(id);
}

/**
 * Loads every persisted plan on app start (SPEC.md §4 journey 1: a
 * returning visit resumes exactly where the user left off, now across
 * however many tabs were open), sorted back into the tab order they were
 * left in. Returns an empty array for a genuine first-time visit — the
 * caller falls back to onboarding.
 */
export async function loadAllSavedScenarios(): Promise<readonly { readonly id: string; readonly name: string; readonly scenario: Scenario; readonly updatedAt: string }[]> {
  const rows = await db.scenarios.toArray();
  // A row saved before this feature existed has no `order` at all at runtime, despite `ScenarioRow`
  // now declaring it required — same "the type is a lie for old data" caveat this file's schema
  // migration story already assumes for `data`. Cast just this read to reflect that honestly.
  const orderOf = (row: ScenarioRow) => (row as { order?: number }).order ?? 0;
  return rows
    .slice()
    .sort((a, b) => orderOf(a) - orderOf(b))
    .map((row) => ({ id: row.id, name: row.name, scenario: migrateToLatest(row.data), updatedAt: row.updatedAt }));
}

/** Wires every open plan's changes to the debounced autosave writer. Call once, at app start. */
export function subscribeAutosave(): () => void {
  return useScenarioStore.subscribe((state, previousState) => {
    if (state.planOrder !== previousState.planOrder) {
      // A structural change (opened/cloned/closed) can shift where an *untouched* sibling plan sits
      // without changing its own content — stamp every open plan's stored order immediately (not
      // debounced, and a no-op for any id that hasn't been written yet) so a later reload doesn't
      // reshuffle tabs back into whatever order Dexie's own id-keyed storage happens to return them in.
      state.planOrder.forEach((id, index) => {
        if (state.plans[id]) {
          void db.scenarios.update(id, { order: index });
        }
      });
    }
    if (state.plans === previousState.plans) return;
    for (const id of state.planOrder) {
      const scenario = state.plans[id];
      // `null` is a tab that hasn't completed onboarding yet — nothing to persist.
      if (scenario && scenario !== previousState.plans[id]) {
        scheduleAutosave(id, scenario, state.planOrder.indexOf(id));
      }
    }
  });
}
