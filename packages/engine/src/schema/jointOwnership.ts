import { multiplyPenceByRate, subtractPence, type Pence } from "../money/pence.js";
import type { Owner, Person, PersonId } from "./types.js";

/**
 * Splits an amount by ownership (SPEC.md §3.1, §5.5, §5.6) — a specific
 * owner gets the whole amount; `"joint"` splits 50/50 between the
 * household's two people (the married/civil-partnership default SPEC.md
 * §5.5 names; no custom-split UI for unmarried co-owners in v1, a
 * documented simplification). In a single-person household, a `"joint"`
 * item is attributed entirely to that one person — there's no one else
 * to split with.
 *
 * The second person's share is always computed as the *remainder*
 * (`amount - firstShare`), never independently rounded, so the two
 * shares are guaranteed to sum exactly back to `amount` — the same
 * exact-by-construction pattern used throughout this engine (e.g. GIA
 * return-of-capital/gain splitting).
 */
export function splitByOwnership(amount: Pence, owner: Owner, people: readonly Person[]): ReadonlyMap<PersonId, Pence> {
  if (owner !== "joint") {
    return new Map([[owner, amount]]);
  }

  const [personA, personB] = people;
  if (!personA) {
    return new Map();
  }
  if (!personB) {
    return new Map([[personA.id, amount]]);
  }

  const shareA = multiplyPenceByRate(amount, 0.5);
  const shareB = subtractPence(amount, shareA);
  return new Map([
    [personA.id, shareA],
    [personB.id, shareB],
  ]);
}
