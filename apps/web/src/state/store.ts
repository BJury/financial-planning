import type { Scenario } from "@fp/engine";
import { create } from "zustand";

export interface ScenarioStore {
  readonly scenario: Scenario | null;
  readonly hasHydrated: boolean;
  /**
   * Bumped only by `loadScenario` below — never by `setScenario` or
   * `updateScenario`, which fire continuously as `Onboarding` syncs its
   * own local edits back out. `Onboarding` reads its starting values from
   * the store exactly once, on mount (SPEC.md §9.2's "resume where you
   * left off"), then owns that state locally from then on; nothing makes
   * it look back at the store afterwards. That's correct for the
   * continuous local-edit case, but wrong the moment something *outside*
   * that editing session replaces the whole scenario — initial hydration
   * (harmless, `Onboarding` hasn't mounted yet) and "Open from file"
   * (the actual bug: importing while already on the main page silently
   * kept every field showing the *old* plan, since nothing forced
   * `Onboarding` to re-read the store). Keying `<Onboarding>` on this
   * counter in `App.tsx` forces exactly the remount needed to pick up an
   * import, without remounting on every keystroke the way keying on
   * `scenario` itself would.
   */
  readonly loadGeneration: number;
  setScenario: (scenario: Scenario) => void;
  /** Use for a wholesale replacement from outside the current editing session (initial hydration, "Open from file") — see `loadGeneration` above. */
  loadScenario: (scenario: Scenario) => void;
  updateScenario: (updater: (scenario: Scenario) => Scenario) => void;
  setHasHydrated: (hasHydrated: boolean) => void;
}

/**
 * Holds the current Scenario in memory (SPEC.md §9.1). Local persistence
 * (autosave to IndexedDB, §9.2) subscribes to this store from outside
 * React rather than living inside a component, so it keeps working
 * regardless of which page is mounted.
 */
export const useScenarioStore = create<ScenarioStore>((set) => ({
  scenario: null,
  hasHydrated: false,
  loadGeneration: 0,
  setScenario: (scenario) => {
    set({ scenario });
  },
  loadScenario: (scenario) => {
    set((state) => ({ scenario, loadGeneration: state.loadGeneration + 1 }));
  },
  updateScenario: (updater) => {
    set((state) => (state.scenario ? { scenario: updater(state.scenario) } : state));
  },
  setHasHydrated: (hasHydrated) => {
    set({ hasHydrated });
  },
}));
