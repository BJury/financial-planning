import type { Household, Person, Scenario } from "@fp/engine";
import { personId } from "@fp/engine";
import { beforeEach, describe, expect, it } from "vitest";
import { useScenarioStore } from "./store.js";

const PERSON_ID = personId("p1");

function makeScenario(name?: string): Scenario {
  const person: Person = { id: PERSON_ID, dateOfBirth: "1980-06-15", targetRetirementAge: 67, projectionEndAge: 85 };
  const household: Household = { people: [person], relationshipStatus: null, targetIncomeMode: "perPerson" };
  return {
    schemaVersion: 1,
    ...(name ? { name } : {}),
    household,
    accounts: [],
    incomeSources: [],
    incomeDrains: [],
    inflationRate: 0.025,
    upratingPolicy: { kind: "inflationLinked" },
  };
}

beforeEach(() => {
  useScenarioStore.setState({ plans: {}, planOrder: [], activePlanId: null, scenario: null, hasHydrated: false, loadGeneration: 0 });
});

describe("useScenarioStore — multiple plans", () => {
  it("openPlanInNewTab appends a tab, makes it active, and bumps loadGeneration", () => {
    const store = useScenarioStore.getState();
    const firstId = store.openPlanInNewTab(makeScenario("First"));
    const secondId = useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));

    const state = useScenarioStore.getState();
    expect(state.planOrder).toEqual([firstId, secondId]);
    expect(state.activePlanId).toBe(secondId);
    expect(state.scenario?.name).toBe("Second");
    expect(state.loadGeneration).toBe(2);
  });

  it("switchActivePlan resyncs scenario to the newly active plan and bumps loadGeneration", () => {
    const store = useScenarioStore.getState();
    const firstId = store.openPlanInNewTab(makeScenario("First"));
    useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));

    useScenarioStore.getState().switchActivePlan(firstId);

    const state = useScenarioStore.getState();
    expect(state.activePlanId).toBe(firstId);
    expect(state.scenario?.name).toBe("First");
    expect(state.loadGeneration).toBe(3);
  });

  it("setScenario/updateScenario write through to the active plan only, leaving other tabs untouched", () => {
    const store = useScenarioStore.getState();
    const firstId = store.openPlanInNewTab(makeScenario("First"));
    const secondId = useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));

    useScenarioStore.getState().setScenario(makeScenario("Second, edited"));

    const state = useScenarioStore.getState();
    expect(state.plans[secondId]?.name).toBe("Second, edited");
    expect(state.plans[firstId]?.name).toBe("First");
  });

  it("clonePlan deep-clones the source plan into a new tab right after it, named '(copy)'", () => {
    const store = useScenarioStore.getState();
    const firstId = store.openPlanInNewTab(makeScenario("First"));
    useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));

    const cloneId = useScenarioStore.getState().clonePlan(firstId);

    const state = useScenarioStore.getState();
    expect(state.planOrder).toEqual([firstId, cloneId, expect.any(String)]);
    expect(state.plans[cloneId]?.name).toBe("First (copy)");
    expect(state.plans[cloneId]).not.toBe(state.plans[firstId]); // distinct object, not a shared reference
    expect(state.activePlanId).toBe(cloneId);
  });

  it("closePlan removes a tab and switches to the adjacent one when the active tab is closed", () => {
    const store = useScenarioStore.getState();
    const firstId = store.openPlanInNewTab(makeScenario("First"));
    const secondId = useScenarioStore.getState().openPlanInNewTab(makeScenario("Second"));
    useScenarioStore.getState().openPlanInNewTab(makeScenario("Third"));
    useScenarioStore.getState().switchActivePlan(secondId);

    useScenarioStore.getState().closePlan(secondId);

    const state = useScenarioStore.getState();
    expect(state.planOrder).not.toContain(secondId);
    expect(state.activePlanId).toBe(firstId); // the tab before the closed one
    expect(state.scenario?.name).toBe("First");
  });

  it("closePlan refuses to close the last remaining tab", () => {
    const store = useScenarioStore.getState();
    const onlyId = store.openPlanInNewTab(makeScenario("Only"));

    useScenarioStore.getState().closePlan(onlyId);

    const state = useScenarioStore.getState();
    expect(state.planOrder).toEqual([onlyId]);
    expect(state.activePlanId).toBe(onlyId);
  });

  it("hydratePlans seeds plans/planOrder/activePlanId from persisted rows", () => {
    const rows = [
      { id: "a", scenario: makeScenario("A") },
      { id: "b", scenario: null },
    ];
    useScenarioStore.getState().hydratePlans(rows, "a");

    const state = useScenarioStore.getState();
    expect(state.planOrder).toEqual(["a", "b"]);
    expect(state.activePlanId).toBe("a");
    expect(state.scenario?.name).toBe("A");
    expect(state.plans.b).toBeNull();
  });
});
