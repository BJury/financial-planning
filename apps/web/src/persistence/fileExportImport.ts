import { migrateToLatest, SchemaMigrationError, type Scenario } from "@fp/engine";

/**
 * Downloads the current Scenario's *inputs* as a portable `.json` file
 * (SPEC.md §9.2) — never a frozen ProjectionResult, since the engine
 * recomputes results deterministically from inputs on every load.
 * `Scenario` already carries its own `schemaVersion` field (SPEC.md §8),
 * so the exported JSON is the Scenario as-is — no separate version stamp
 * to keep in sync.
 */
export function exportScenarioToFile(scenario: Scenario, filename = "retirement-plan.json"): void {
  const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export interface ImportResult {
  readonly kind: "success";
  readonly scenario: Scenario;
}

export interface ImportFailure {
  readonly kind: "failure";
  readonly message: string;
}

/**
 * Reads a user-selected file and migrates it to the current schema
 * (SPEC.md §9.2) — never a silent partial import; a corrupted or
 * too-new file is reported as a failure, not guessed at.
 */
export async function importScenarioFromFile(file: File): Promise<ImportResult | ImportFailure> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { kind: "failure", message: "Couldn't read that file." };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { kind: "failure", message: "That file isn't valid JSON." };
  }

  try {
    const scenario = migrateToLatest(parsed);
    return { kind: "success", scenario };
  } catch (error) {
    if (error instanceof SchemaMigrationError) {
      return { kind: "failure", message: error.message };
    }
    return { kind: "failure", message: "That file isn't a recognised Scenario export." };
  }
}
