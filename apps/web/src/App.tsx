import { Button, Group, Loader, MantineProvider, Modal, Stack, Text } from "@mantine/core";
import type { Scenario } from "@fp/engine";
import { useEffect, useState } from "react";
import { HashRouter, Route, Routes } from "react-router";
import { loadSavedScenario, subscribeAutosave } from "./persistence/autosave.js";
import { clearShareParam, decodeShareParam, readShareParam } from "./persistence/shareLink.js";
import { Onboarding } from "./pages/Onboarding.js";
import { StressTest } from "./pages/StressTest.js";
import { TargetSensitivity } from "./pages/TargetSensitivity.js";
import { TaxBreakdown } from "./pages/TaxBreakdown.js";
import { useScenarioStore } from "./state/store.js";

type PendingShare = { readonly kind: "confirm"; readonly scenario: Scenario } | { readonly kind: "error"; readonly message: string };

export function App() {
  const hasHydrated = useScenarioStore((s) => s.hasHydrated);
  const loadScenario = useScenarioStore((s) => s.loadScenario);
  const loadGeneration = useScenarioStore((s) => s.loadGeneration);
  const setHasHydrated = useScenarioStore((s) => s.setHasHydrated);
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);

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

    // A shared link (`?p=...`, see persistence/shareLink.ts) is decoded
    // alongside the autosave load, never in place of it — opening someone
    // else's link shouldn't silently clobber a plan already in progress,
    // so it's held for confirmation instead. The param is stripped either
    // way so a refresh never re-prompts and it never lingers in the
    // address bar (or browser history going forward).
    const shareParam = readShareParam();
    if (shareParam) {
      void decodeShareParam(shareParam).then((result) => {
        clearShareParam();
        setPendingShare(result.kind === "success" ? { kind: "confirm", scenario: result.scenario } : { kind: "error", message: result.message });
      });
    }

    return subscribeAutosave();
  }, [loadScenario, setHasHydrated]);

  return (
    <MantineProvider defaultColorScheme="auto">
      <Modal opened={pendingShare?.kind === "confirm"} onClose={() => setPendingShare(null)} title="Open shared plan?">
        <Stack gap="md">
          <Text size="sm">This link contains a full plan. Opening it will replace your current plan.</Text>
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setPendingShare(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingShare?.kind === "confirm") loadScenario(pendingShare.scenario);
                setPendingShare(null);
              }}
            >
              Open shared plan
            </Button>
          </Group>
        </Stack>
      </Modal>
      <Modal opened={pendingShare?.kind === "error"} onClose={() => setPendingShare(null)} title="Couldn't open shared plan">
        <Stack gap="md">
          <Text size="sm">{pendingShare?.kind === "error" ? pendingShare.message : ""}</Text>
          <Group justify="flex-end">
            <Button onClick={() => setPendingShare(null)}>OK</Button>
          </Group>
        </Stack>
      </Modal>
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
            <Route path="/target-sensitivity" element={<TargetSensitivity />} />
          </Routes>
        </HashRouter>
      ) : (
        <Loader m="xl" />
      )}
    </MantineProvider>
  );
}
