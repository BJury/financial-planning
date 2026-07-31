import { Button, Text, type ButtonProps } from "@mantine/core";
import { useRef, useState, type ChangeEvent } from "react";
import { useNavigate } from "react-router";
import { importScenarioFromFile } from "../persistence/fileExportImport.js";
import { useScenarioStore } from "../state/store.js";

/**
 * "Open from file" (SPEC.md §9.2) — the only way a plan survives clearing
 * browser data, moving to a new device, or leaving private/incognito mode
 * without a share link already in hand. Always visible in `Onboarding`'s
 * plan/tab-management row, alongside "Save to file" (the symmetric
 * counterpart — both move a scenario's inputs to/from your own
 * filesystem), even before any plan exists, since it's the way *into* a
 * plan for a returning user starting fresh on a new device. "Share link"
 * and "Export report" stay with `ProjectionResults`'s other
 * projection-scoped actions instead — see `PlanShareControls.tsx`.
 */
export function OpenFromFileButton({ variant = "default", size = "xs", px }: Pick<ButtonProps, "variant" | "size" | "px">) {
  const openPlanInNewTab = useScenarioStore((s) => s.openPlanInNewTab);
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
    // Opens as a new tab, alongside whatever's already open, rather than
    // replacing it — also bumps `loadGeneration`, so `Onboarding` (keyed
    // on it in App.tsx) remounts and actually shows the imported plan
    // even when the import happens while already on the main page, where
    // `navigate("/")` below is otherwise a no-op.
    openPlanInNewTab(result.scenario);
    // Recalculated fresh against the app's current tax rules on load
    // (SPEC.md §9.2) — landing back on the main planner view shows that
    // recalculation immediately, rather than leaving the user to guess.
    void navigate("/");
  };

  return (
    <>
      <Button variant={variant} size={size} {...(px !== undefined ? { px } : {})} onClick={() => fileInputRef.current?.click()}>
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
