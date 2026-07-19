import { Loader, MantineProvider } from "@mantine/core";
import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { loadSavedScenario, subscribeAutosave } from "./persistence/autosave.js";
import { Onboarding } from "./pages/Onboarding.js";
import { StressTest } from "./pages/StressTest.js";
import { TaxBreakdown } from "./pages/TaxBreakdown.js";
import { useScenarioStore } from "./state/store.js";

export function App() {
  const hasHydrated = useScenarioStore((s) => s.hasHydrated);
  const loadScenario = useScenarioStore((s) => s.loadScenario);
  const loadGeneration = useScenarioStore((s) => s.loadGeneration);
  const setHasHydrated = useScenarioStore((s) => s.setHasHydrated);

  useEffect(() => {
    // Returning visit: resume exactly where the user left off (SPEC.md §4
    // journey 1). A first-time visit finds nothing and falls through to
    // Onboarding, which is the router's default route.
    void loadSavedScenario().then((scenario) => {
      if (scenario) {
        loadScenario(scenario);
      }
      setHasHydrated(true);
    });

    return subscribeAutosave();
  }, [loadScenario, setHasHydrated]);

  return (
    <MantineProvider defaultColorScheme="auto">
      {hasHydrated ? (
        // HashRouter, not BrowserRouter (SPEC.md §9.1's "no server" already
        // means no rewrites available on GitHub Pages either) — a direct
        // link or refresh on /tax-breakdown would 404 under BrowserRouter's
        // history-API routing, since static hosting can't rewrite arbitrary
        // paths back to index.html. The hash fragment never reaches the
        // server at all, so this works identically on any static host.
        <HashRouter>
          <Routes>
            {/* Keyed on loadGeneration so an "Open from file" import while already on this page forces a remount — see the doc comment on ScenarioStore.loadGeneration. */}
            <Route path="/" element={<Onboarding key={loadGeneration} />} />
            <Route path="/tax-breakdown" element={<TaxBreakdown />} />
            <Route path="/stress-test" element={<StressTest />} />
          </Routes>
        </HashRouter>
      ) : (
        <Loader m="xl" />
      )}
    </MantineProvider>
  );
}
