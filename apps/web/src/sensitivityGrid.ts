import { ageAtYear, type Person, type ProjectionResult } from "@fp/engine";

/** Guards against a runaway grid from an extreme range/step combination — at ~3ms/combination (SPEC.md §9.7), this is comfortably under a second even worst-case. Shared by every "vary two scenario inputs across a grid" page (Stress Test, Target Sensitivity). */
export const MAX_COMBINATIONS = 400;

/**
 * Every value from `min` to `max` in `step` increments, plus `0` always
 * included — `0` is "no change from your current assumptions," the
 * baseline every other cell is being compared against, and it wouldn't
 * necessarily land exactly on the step grid otherwise (e.g. min −3.5,
 * step 1). Rounded to guard against floating-point drift from repeated
 * addition (e.g. 0.1 + 0.1 + 0.1 !== 0.3).
 */
export function buildDeltaSteps(min: number, max: number, step: number): readonly number[] {
  if (step <= 0 || min > max) return [0];
  const values = new Set<number>();
  for (let v = min; v <= max + 1e-9; v += step) {
    values.add(Math.round(v * 1000) / 1000);
  }
  values.add(0);
  return [...values].sort((a, b) => a - b);
}

export interface Shortfall {
  readonly taxYear: string;
  readonly calendarYear: number;
  /** Position within the projection (0 = the very first year) — used to shade earlier failures more intensely than later ones, not for display. */
  readonly yearIndex: number;
}

/** The first year, if any, where any household member's drawdown target or a continuous outflow wasn't fully covered — the same two signals `ProjectionResults.tsx`'s "Key flags"/shortfall shading already use for identical purpose. */
export function firstShortfall(result: ProjectionResult): Shortfall | null {
  for (let yearIndex = 0; yearIndex < result.rows.length; yearIndex++) {
    const row = result.rows[yearIndex];
    if (row?.perPerson.some((p) => p.drawdownShortfall || p.livingExpensesShortfall)) {
      return { taxYear: row.taxYear, calendarYear: row.calendarYear, yearIndex };
    }
  }
  return null;
}

/** Each household member's age in the given calendar year — "You 68, Partner 63" once a second person exists, just "68" for one. Doesn't account for survivorship (SPEC.md §5.7.5): a variant scenario's own household composition doesn't change, so there's nothing to drop. */
export function ageLabel(calendarYear: number, people: readonly Person[]): string {
  return people
    .map((p, index) => (people.length > 1 ? `${index === 0 ? "You" : "Partner"} ${ageAtYear(p.dateOfBirth, calendarYear)}` : `${ageAtYear(p.dateOfBirth, calendarYear)}`))
    .join(", ");
}

/**
 * 1 for the earliest shortfall anywhere in the grid, fading toward 0 as
 * the failure year gets later — a single shortfall value (or none at
 * all) shades at full intensity, since there's nothing to fade relative to.
 */
export function shortfallIntensity(yearIndex: number, range: { readonly min: number; readonly max: number } | null): number {
  if (!range || range.max === range.min) return 1;
  return 1 - (yearIndex - range.min) / (range.max - range.min);
}

/**
 * Blends red with the theme's own background colour via `color-mix`
 * rather than picking a fixed Mantine shade, so the gradient stays
 * correctly contrasted in both light and dark mode without a separate
 * palette for each — `--mantine-color-body` already tracks the active
 * colour scheme.
 */
export function shortfallCellBackground(intensity: number): string {
  const alphaPercent = Math.round(15 + intensity * 65);
  return `color-mix(in srgb, var(--mantine-color-red-6) ${alphaPercent}%, var(--mantine-color-body))`;
}
