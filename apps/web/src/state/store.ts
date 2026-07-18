import type { Scenario } from "@fp/engine";
import { create } from "zustand";

export interface ScenarioStore {
  readonly scenario: Scenario | null;
  readonly hasHydrated: boolean;
  setScenario: (scenario: Scenario) => void;
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
  setScenario: (scenario) => {
    set({ scenario });
  },
  updateScenario: (updater) => {
    set((state) => (state.scenario ? { scenario: updater(state.scenario) } : state));
  },
  setHasHydrated: (hasHydrated) => {
    set({ hasHydrated });
  },
}));
