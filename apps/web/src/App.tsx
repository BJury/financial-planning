import { Loader, MantineProvider } from "@mantine/core";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router";
import { loadSavedScenario, subscribeAutosave } from "./persistence/autosave.js";
import { Dashboard } from "./pages/Dashboard.js";
import { Onboarding } from "./pages/Onboarding.js";
import { useScenarioStore } from "./state/store.js";

export function App() {
  const hasHydrated = useScenarioStore((s) => s.hasHydrated);
  const setScenario = useScenarioStore((s) => s.setScenario);
  const setHasHydrated = useScenarioStore((s) => s.setHasHydrated);

  useEffect(() => {
    // Returning visit: resume exactly where the user left off (SPEC.md §4
    // journey 1). A first-time visit finds nothing and falls through to
    // Onboarding, which is the router's default route.
    void loadSavedScenario().then((scenario) => {
      if (scenario) {
        setScenario(scenario);
      }
      setHasHydrated(true);
    });

    return subscribeAutosave();
  }, [setScenario, setHasHydrated]);

  return (
    <MantineProvider>
      {hasHydrated ? (
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Onboarding />} />
            <Route path="/dashboard" element={<Dashboard />} />
          </Routes>
        </BrowserRouter>
      ) : (
        <Loader m="xl" />
      )}
    </MantineProvider>
  );
}
