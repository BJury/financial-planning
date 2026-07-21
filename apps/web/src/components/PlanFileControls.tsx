import { Button, Group, Text } from "@mantine/core";
import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { exportScenarioToFile, importScenarioFromFile } from "../persistence/fileExportImport.js";
import { useScenarioStore } from "../state/store.js";

/**
 * "Save to file" / "Open from file" (SPEC.md §9.2) — the secondary,
 * not-optional persistence path alongside autosave: the only way a plan
 * survives clearing browser data, moving to a new device, or leaving
 * private/incognito mode. Lives in the main planner's header so it's
 * reachable from wherever the user happens to be, per §9.2's "not left
 * undiscovered as a menu item."
 */
/**
 * Derives a safe filename from the scenario's own (optional) `name` —
 * strips characters that are invalid across Windows/macOS/Linux
 * filesystems rather than just the ones any one OS happens to reject, so
 * the same export behaves the same way regardless of where it's later
 * opened. Falls back to the previous fixed filename when unset or when
 * sanitising leaves nothing usable.
 */
function filenameForScenario(name: string | undefined): string {
  const sanitised = (name ?? "").replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return sanitised ? `${sanitised}.json` : "retirement-plan.json";
}

export function PlanFileControls() {
  const scenario = useScenarioStore((s) => s.scenario);
  const loadScenario = useScenarioStore((s) => s.loadScenario);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = () => {
    if (!scenario) return;
    exportScenarioToFile(scenario, filenameForScenario(scenario.name));
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ""; // lets the same file be re-selected later (e.g. after fixing it)
    if (!file) return;

    const result = await importScenarioFromFile(file);
    if (result.kind === "failure") {
      setImportError(result.message);
      return;
    }

    setImportError(null);
    // `loadScenario`, not `setScenario` — bumps `loadGeneration` too, so
    // `Onboarding` (keyed on it in App.tsx) remounts and actually picks
    // up the imported plan even when the import happens while already on
    // the main page, where `navigate("/")` below is otherwise a no-op.
    loadScenario(result.scenario);
    // Recalculated fresh against the app's current tax rules on load
    // (SPEC.md §9.2) — landing back on the main planner view shows that
    // recalculation immediately, rather than leaving the user to guess.
    void navigate("/");
  };

  return (
    <Group gap="xs" wrap="nowrap">
      <Button variant="subtle" size="xs" onClick={handleExport} disabled={!scenario}>
        Save to file
      </Button>
      <Button variant="subtle" size="xs" onClick={() => fileInputRef.current?.click()}>
        Open from file
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: "none" }}
        onChange={(event) => void handleFileSelected(event)}
      />
      {importError && (
        <Text size="sm" c="red">
          {importError}
        </Text>
      )}
    </Group>
  );
}
