import { runStochasticBatch, type Scenario, type StochasticBatchResult, type StochasticMethod } from "@fp/engine";
import type { DrawdownGuardrailPolicy, TaxYearRuleSet } from "@fp/engine";

/**
 * A single `runProjection` call is ~3ms (SPEC.md §9.7); a stochastic batch
 * runs hundreds-to-thousands of them, which would visibly freeze the UI
 * thread. This worker runs the batch off-thread instead, reporting
 * progress so the "Confidence" page (`pages/StochasticProjection.tsx`) can
 * show a progress bar rather than an unresponsive page.
 */
export interface StochasticWorkerRequest {
  readonly scenario: Scenario;
  readonly confirmedRuleSet: TaxYearRuleSet;
  readonly numberOfYears: number;
  readonly method: StochasticMethod;
  readonly runCount: number;
  readonly seed?: number;
  /** Opt-in Guyton-Klinger dynamic withdrawal guardrails — omitted reproduces today's flat-target behaviour exactly. */
  readonly guardrails?: DrawdownGuardrailPolicy;
}

export type StochasticWorkerMessage =
  | { readonly kind: "progress"; readonly completed: number; readonly total: number }
  | { readonly kind: "done"; readonly result: StochasticBatchResult };

/**
 * `self` under this project's tsconfig (`lib: ["DOM", ...]`, no
 * `"webworker"`) types as `Window`, not `DedicatedWorkerGlobalScope` — TS
 * doesn't allow mixing the `DOM` and `WebWorker` libs in one program, and
 * this app's main-thread code already needs `DOM`. Casting once here,
 * rather than adding a second tsconfig project just for this one file, is
 * correct at runtime (`self` genuinely is the worker's global scope when
 * this module is loaded as a Worker) and keeps the message shapes typed.
 */
const workerScope = self as unknown as {
  postMessage: (message: StochasticWorkerMessage) => void;
  onmessage: ((event: MessageEvent<StochasticWorkerRequest>) => void) | null;
};

// Reported at most every 25 runs (plus always on the final run) — frequent
// enough for a smooth-looking progress bar, infrequent enough not to
// flood the main thread with messages during a fast batch.
const PROGRESS_REPORT_INTERVAL = 25;

workerScope.onmessage = (event) => {
  const { scenario, confirmedRuleSet, numberOfYears, method, runCount, seed, guardrails } = event.data;

  const result = runStochasticBatch({
    scenario,
    confirmedRuleSet,
    numberOfYears,
    method,
    runCount,
    ...(seed !== undefined ? { seed } : {}),
    ...(guardrails !== undefined ? { guardrails } : {}),
    onProgress: (completed, total) => {
      if (completed % PROGRESS_REPORT_INTERVAL === 0 || completed === total) {
        workerScope.postMessage({ kind: "progress", completed, total });
      }
    },
  });

  workerScope.postMessage({ kind: "done", result });
};
