import { Button, Group, Text } from "@mantine/core";
import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { exportScenarioToFile, importScenarioFromFile } from "../persistence/fileExportImport.js";
import { useScenarioStore } from "../state/store.js";

/**
 * "Save to file" / "Open from file" (SPEC.md §9.2) — the secondary,
 * not-optional persistence path alongside autosave: the only way a plan
 * survives clearing browser data, moving to a new device, or leaving
 * private/incognito mode. Shared by Onboarding and Dashboard so it's
 * reachable from wherever the user happens to be, per §9.2's "not left
 * undiscovered as a menu item."
 */
export function PlanFileControls() {
  const scenario = useScenarioStore((s) => s.scenario);
  const setScenario = useScenarioStore((s) => s.setScenario);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const handleExport = () => {
    if (!scenario) return;
    exportScenarioToFile(scenario);
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
    setScenario(result.scenario);
    // Recalculated fresh against the app's current tax rules on load
    // (SPEC.md §9.2) — jumping straight to the projection shows that
    // recalculation immediately, rather than leaving the user to guess.
    void navigate("/dashboard");
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
