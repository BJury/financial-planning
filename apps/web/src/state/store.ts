import type { Scenario } from "@fp/engine";
import { create } from "zustand";

export interface ScenarioStore {
  /** Every currently open plan, keyed by a stable id generated when it was opened (or its Dexie row id, for anything hydrated from a prior session). `null` means a tab that hasn't completed onboarding yet — the exact state a genuine first-time visitor starts from. */
  readonly plans: Record<string, Scenario | null>;
  /** Tab display order — a separate field rather than relying on `Object.keys(plans)` order, since closing and re-adding tabs shouldn't reshuffle the ones left in place. */
  readonly planOrder: readonly string[];
  /** The plan currently shown across every page. `null` only before hydration completes; every action below that can run post-hydration assumes it's set. */
  readonly activePlanId: string | null;
  /** Always `plans[activePlanId] ?? null` — kept as its own field, recomputed by every action below, purely so existing callers (every page) can keep reading "the current scenario" exactly as before without knowing tabs exist. */
  readonly scenario: Scenario | null;
  readonly hasHydrated: boolean;
  /**
   * Bumped by every action that replaces *which* scenario `scenario`
   * points to from outside the current editing session — switching tabs,
   * opening a new tab (import/share/clone/new), never by `setScenario`/
   * `updateScenario`, which fire continuously as `Onboarding` syncs its
   * own local edits back out. `Onboarding` reads its starting values from
   * the store exactly once, on mount, then owns that state locally from
   * then on; nothing makes it look back at the store afterwards. That's
   * correct for the continuous local-edit case, but wrong the moment the
   * active plan changes underneath it — keying `<Onboarding>` on this
   * counter in `App.tsx` forces exactly the remount needed to pick up a
   * new active plan's data, without remounting on every keystroke the way
   * keying on `scenario` itself would.
   */
  readonly loadGeneration: number;
  setScenario: (scenario: Scenario) => void;
  updateScenario: (updater: (scenario: Scenario) => Scenario) => void;
  /** Boot-time bulk load of every persisted plan (SPEC.md §9.2's "resume where you left off") — call once, before anything else touches the store. */
  hydratePlans: (rows: readonly { readonly id: string; readonly scenario: Scenario | null }[], activePlanId: string) => void;
  /** Switches which open plan is shown across every page. */
  switchActivePlan: (id: string) => void;
  /** Opens a wholesale-external scenario (an import, a share link, or `null` for "New tab") as a new tab and switches to it. Returns the new tab's id. */
  openPlanInNewTab: (scenario: Scenario | null, name?: string) => string;
  /** Deep-clones a plan (defaults to the active one) into a new tab right after its source, named "<name> (copy)", and switches to it. Returns the new tab's id. */
  clonePlan: (id?: string) => string;
  /** Closes a tab. Refuses (no-ops) if it's the last one open — there must always be at least one. Switches to an adjacent tab if the closed one was active. */
  closePlan: (id: string) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

function scenarioFor(plans: Record<string, Scenario | null>, activePlanId: string | null): Scenario | null {
  return activePlanId ? (plans[activePlanId] ?? null) : null;
}

/**
 * Holds every currently open Scenario in memory (SPEC.md §9.1), plus
 * which one is active. Local persistence (autosave to IndexedDB, §9.2)
 * subscribes to this store from outside React rather than living inside a
 * component, so it keeps working regardless of which page is mounted.
 */
export const useScenarioStore = create<ScenarioStore>((set) => ({
  plans: {},
  planOrder: [],
  activePlanId: null,
  scenario: null,
  hasHydrated: false,
  loadGeneration: 0,
  setScenario: (scenario) => {
    set((state) => {
      if (!state.activePlanId) return state;
      const plans = { ...state.plans, [state.activePlanId]: scenario };
      return { plans, scenario };
    });
  },
  updateScenario: (updater) => {
    set((state) => {
      if (!state.activePlanId || !state.scenario) return state;
      const scenario = updater(state.scenario);
      const plans = { ...state.plans, [state.activePlanId]: scenario };
      return { plans, scenario };
    });
  },
  hydratePlans: (rows, activePlanId) => {
    const plans = Object.fromEntries(rows.map((row) => [row.id, row.scenario]));
    const planOrder = rows.map((row) => row.id);
    set((state) => ({ plans, planOrder, activePlanId, scenario: scenarioFor(plans, activePlanId), loadGeneration: state.loadGeneration + 1 }));
  },
  switchActivePlan: (id) => {
    set((state) => {
      if (!(id in state.plans)) return state;
      return { activePlanId: id, scenario: scenarioFor(state.plans, id), loadGeneration: state.loadGeneration + 1 };
    });
  },
  openPlanInNewTab: (scenario, name) => {
    const id = crypto.randomUUID();
    set((state) => {
      const value = scenario && name ? { ...scenario, name } : scenario;
      const plans = { ...state.plans, [id]: value };
      const planOrder = [...state.planOrder, id];
      return { plans, planOrder, activePlanId: id, scenario: value, loadGeneration: state.loadGeneration + 1 };
    });
    return id;
  },
  clonePlan: (id) => {
    const newId = crypto.randomUUID();
    set((state) => {
      const sourceId = id ?? state.activePlanId;
      const source = sourceId ? (state.plans[sourceId] ?? null) : null;
      const cloned = source ? structuredClone(source.name ? { ...source, name: `${source.name} (copy)` } : source) : null;
      const sourceIndex = sourceId ? state.planOrder.indexOf(sourceId) : -1;
      const planOrder =
        sourceIndex === -1
          ? [...state.planOrder, newId]
          : [...state.planOrder.slice(0, sourceIndex + 1), newId, ...state.planOrder.slice(sourceIndex + 1)];
      const plans = { ...state.plans, [newId]: cloned };
      return { plans, planOrder, activePlanId: newId, scenario: cloned, loadGeneration: state.loadGeneration + 1 };
    });
    return newId;
  },
  closePlan: (id) => {
    set((state) => {
      if (state.planOrder.length <= 1) return state;
      const index = state.planOrder.indexOf(id);
      if (index === -1) return state;
      const planOrder = state.planOrder.filter((planId) => planId !== id);
      const plans = Object.fromEntries(Object.entries(state.plans).filter(([planId]) => planId !== id));
      if (state.activePlanId !== id) {
        return { plans, planOrder };
      }
      // `planOrder.length > 1` on entry guarantees at least one id survives the filter above.
      const nextActiveId = (planOrder[Math.max(0, index - 1)] ?? planOrder[0]) as string;
      return { plans, planOrder, activePlanId: nextActiveId, scenario: scenarioFor(plans, nextActiveId), loadGeneration: state.loadGeneration + 1 };
    });
  },
  setHasHydrated: (hasHydrated) => {
    set({ hasHydrated });
  },
}));
