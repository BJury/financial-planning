import "fake-indexeddb/auto";
import type { Household, Person, Scenario } from "@fp/engine";
import { personId } from "@fp/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { useScenarioStore } from "../state/store.js";
import { deletePlanRow, loadAllSavedScenarios, scheduleAutosave, subscribeAutosave } from "./autosave.js";
import { db } from "./db.js";

const PERSON_ID = personId("p1");

function makeScenario(name: string): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    name,
    household,
    accounts: [],
    incomeSources: [],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

// fake-indexeddb's own internal task scheduling relies on real timers, so these tests use a real
// (short) wait past the 400ms debounce rather than vi.useFakeTimers() — which would freeze the very
// timers fake-indexeddb needs to resolve its transactions.
const PAST_DEBOUNCE_MS = 500;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

beforeEach(async () => {
  await db.scenarios.clear();
  useScenarioStore.setState({ plans: {}, planOrder: [], activePlanId: null, scenario: null, hasHydrated: false, loadGeneration: 0 });
});

describe("autosave — per-plan persistence", () => {
  it("scheduleAutosave debounces independently per plan id — two rapid edits to two different tabs each eventually persist to their own row", async () => {
    scheduleAutosave("plan-a", makeScenario("A"), 0);
    scheduleAutosave("plan-b", makeScenario("B"), 1);
    // A second, later edit to plan-a should reset only plan-a's timer, not plan-b's.
    scheduleAutosave("plan-a", makeScenario("A, edited"), 0);

    await wait(PAST_DEBOUNCE_MS);

    const rowA = await db.scenarios.get("plan-a");
    const rowB = await db.scenarios.get("plan-b");
    expect((rowA?.data as Scenario).name).toBe("A, edited");
    expect((rowB?.data as Scenario).name).toBe("B");
  }, 10000);

  it("deletePlanRow cancels that id's pending write and removes its row, without touching other ids", async () => {
    scheduleAutosave("plan-a", makeScenario("A"), 0);
    scheduleAutosave("plan-b", makeScenario("B"), 1);

    await deletePlanRow("plan-a");
    await wait(PAST_DEBOUNCE_MS);

    expect(await db.scenarios.get("plan-a")).toBeUndefined();
    expect((await db.scenarios.get("plan-b"))?.data).toMatchObject({ name: "B" });
  }, 10000);

  it("loadAllSavedScenarios returns every persisted row", async () => {
    scheduleAutosave("plan-a", makeScenario("A"), 0);
    scheduleAutosave("plan-b", makeScenario("B"), 1);
    await wait(PAST_DEBOUNCE_MS);

    const rows = await loadAllSavedScenarios();
    expect(rows.map((r) => r.id).sort()).toEqual(["plan-a", "plan-b"]);
    expect(rows.find((r) => r.id === "plan-a")?.scenario.name).toBe("A");
  }, 10000);

  it("loadAllSavedScenarios sorts by stored tab order, not insertion/id order", async () => {
    // Written deliberately out of alphabetical/insertion order (b before a) — the sort must come from
    // the `order` field, not from Dexie's own id-keyed row order.
    scheduleAutosave("plan-b", makeScenario("B"), 1);
    scheduleAutosave("plan-a", makeScenario("A"), 0);
    await wait(PAST_DEBOUNCE_MS);

    const rows = await loadAllSavedScenarios();
    expect(rows.map((r) => r.id)).toEqual(["plan-a", "plan-b"]);
  }, 10000);

  it("subscribeAutosave re-stamps every open plan's stored order when a tab is inserted in the middle, even for siblings whose own content didn't change", async () => {
    const unsubscribe = subscribeAutosave();
    const firstId = useScenarioStore.getState().openPlanInNewTab(makeScenario("First"));
    const secondId = useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));
    await wait(PAST_DEBOUNCE_MS);

    // Clone the first plan — it's inserted directly after it, pushing "Second" from index 1 to index 2,
    // even though "Second" itself was never edited.
    useScenarioStore.getState().clonePlan(firstId);
    await wait(PAST_DEBOUNCE_MS);

    const rows = await loadAllSavedScenarios();
    expect(rows.map((r) => r.id)).toEqual(useScenarioStore.getState().planOrder);
    expect(rows.find((r) => r.id === secondId)).toBeDefined();
    unsubscribe();
  }, 10000);

  it("subscribeAutosave persists a plan once it's no longer null (onboarding completing), but never while it's still null", async () => {
    const unsubscribe = subscribeAutosave();
    const id = useScenarioStore.getState().openPlanInNewTab(null);
    await wait(PAST_DEBOUNCE_MS);
    expect(await db.scenarios.get(id)).toBeUndefined();

    useScenarioStore.getState().setScenario(makeScenario("Now onboarded"));
    await wait(PAST_DEBOUNCE_MS);

    expect((await db.scenarios.get(id))?.data).toMatchObject({ name: "Now onboarded" });
    unsubscribe();
  }, 10000);
});
