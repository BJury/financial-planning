import { Button, Text } from "@mantine/core";
import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { importScenarioFromFile } from "../persistence/fileExportImport.js";
import { useScenarioStore } from "../state/store.js";

/**
 * "Open from file" (SPEC.md §9.2) — the only way a plan survives clearing
 * browser data, moving to a new device, or leaving private/incognito mode
 * without a share link already in hand. Always visible in the main header,
 * even before any plan exists, since it's the way *into* a plan for a
 * returning user starting fresh on a new device. "Save to file" and
 * "Share link" live with `ProjectionResults`'s other projection-scoped
 * actions instead — see `PlanShareControls.tsx`.
 */
export function OpenFromFileButton() {
  const loadScenario = useScenarioStore((s) => s.loadScenario);
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);

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
    <>
      <Button variant="default" size="xs" onClick={() => fileInputRef.current?.click()}>
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
    </>
  );
}
