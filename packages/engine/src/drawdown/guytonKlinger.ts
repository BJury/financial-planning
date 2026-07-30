import { growPenceByRate, type Pence } from "../money/pence.js";
import { adjustDrawdownTargetForAutomaticIncome } from "./adjustDrawdownTargetForAutomaticIncome.js";

/**
 * The two classic Guyton-Klinger "guardrail" rules — Capital Preservation
 * (cut spending when the current withdrawal rate has drifted too far
 * *above* where it started) and Prosperity (raise it when drifted too far
 * *below*) — expressed as fractional triggers/adjustments relative to a
 * baseline rate established once, at the start of a drawdown phase. The
 * classic G-K "inflation rule" (skip an inflation raise in a down year)
 * has no separate analogue here: this engine already works in real
 * (today's-money) terms throughout, so a target this policy leaves
 * unchanged *is* the "no adjustment" case.
 */
export interface DrawdownGuardrailPolicy {
  /** e.g. 0.20 — cut when the current withdrawal rate exceeds the baseline rate by more than this fraction. */
  readonly cutTriggerPct: number;
  /** e.g. 0.10 — size of the cut, applied to the carried target. */
  readonly cutAmountPct: number;
  /** e.g. 0.20 — raise when the current withdrawal rate falls below the baseline rate by more than this fraction. */
  readonly raiseTriggerPct: number;
  /** e.g. 0.10 — size of the raise, applied to the carried target. */
  readonly raiseAmountPct: number;
}

export interface GuardrailState {
  /** This phase's withdrawal rate at the point drawdown started — fixed for the life of the phase; every later year's rate is compared back to this, never to the previous year's. */
  readonly baselineRate: number;
  /** The raw (pre-automatic-income-netting) target this rule has carried forward — starts at the phase's own `targetNetAnnualIncome`, nudged by cuts/raises in later years. */
  readonly carriedTarget: Pence;
}

export interface GuardrailResult {
  /** Feed this into `adjustDrawdownTargetForAutomaticIncome` exactly as the un-nudged `config.targetNetAnnualIncome` would be today. */
  readonly rawTarget: Pence;
  /** Carry this forward to next year's call for the same income source id. */
  readonly nextState: GuardrailState;
  readonly event: "cut" | "raise" | "none";
}

/**
 * One year's guardrail review for a single `targetDrawdownIncome` phase.
 * `priorState` absent means this is the phase's first active year: the
 * baseline rate is established (from the post-netting rate, at
 * `drawdownPoolValue`) and never itself nudged. Every subsequent call
 * re-derives the *current* rate from the carried raw target and compares
 * it to that fixed baseline, cutting or raising the carried target
 * accordingly (never both in the same year) — a rate exactly on a
 * trigger boundary does not fire.
 *
 * `drawdownPoolValue` must be the same drawdown-eligible account pool
 * `solveDrawdown`/`solveHouseholdDrawdown` themselves draw from (pension +
 * ISA + cash + GIA for this source's owner(s)) — not net worth, which
 * also includes property and subtracts mortgage balances, a materially
 * different and wrong denominator for a withdrawal rate.
 */
export function applyGuytonKlinger(
  priorState: GuardrailState | undefined,
  config: { readonly targetNetAnnualIncome: Pence },
  drawdownPoolValue: Pence,
  otherNetIncomeAlreadyReceivable: Pence,
  policy: DrawdownGuardrailPolicy,
): GuardrailResult {
  const rateFor = (rawTarget: Pence): number => {
    if (drawdownPoolValue <= 0) return 0;
    const natural = adjustDrawdownTargetForAutomaticIncome(rawTarget, otherNetIncomeAlreadyReceivable);
    return natural / drawdownPoolValue;
  };

  if (!priorState) {
    const carriedTarget = config.targetNetAnnualIncome;
    return { rawTarget: carriedTarget, nextState: { baselineRate: rateFor(carriedTarget), carriedTarget }, event: "none" };
  }

  const currentRate = rateFor(priorState.carriedTarget);
  const { baselineRate } = priorState;

  if (currentRate > baselineRate * (1 + policy.cutTriggerPct)) {
    const nextTarget = growPenceByRate(priorState.carriedTarget, -policy.cutAmountPct);
    return { rawTarget: nextTarget, nextState: { baselineRate, carriedTarget: nextTarget }, event: "cut" };
  }

  if (currentRate < baselineRate * (1 - policy.raiseTriggerPct)) {
    const nextTarget = growPenceByRate(priorState.carriedTarget, policy.raiseAmountPct);
    return { rawTarget: nextTarget, nextState: { baselineRate, carriedTarget: nextTarget }, event: "raise" };
  }

  return { rawTarget: priorState.carriedTarget, nextState: priorState, event: "none" };
}
