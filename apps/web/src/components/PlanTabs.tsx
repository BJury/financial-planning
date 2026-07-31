import { ActionIcon, Tabs, TextInput } from "@mantine/core";
import { useState, type MouseEvent } from "react";
import { deletePlanRow } from "../persistence/autosave.js";
import { useScenarioStore } from "../state/store.js";

interface PlanTabsProps {
  /** The active plan's live, not-yet-debounced name — `Onboarding` owns this the same way it owns
      every other field on the page, so typing here flows through the exact same sync/autosave path,
      not a second competing write. Inactive tabs read their name straight from the store instead,
      since `Onboarding` only holds a live draft of the *active* plan. */
  readonly activePlanName: string;
  readonly onActivePlanNameChange: (name: string) => void;
}

/**
 * The open-plans switcher, and — since the header's old standalone plan-name
 * input was folded into it — also where a plan gets renamed: click the
 * active tab to edit it in place, blur (or Enter) to stop editing.
 * Always rendered, even with a single plan open, since renaming now has
 * nowhere else to happen. Closing a tab discards its persisted row too
 * (`deletePlanRow`) — this isn't a saved-plans library, just the currently
 * open set. The "+" at the end opens a new blank tab — folded in here
 * (rather than a separate "New tab" button elsewhere) since it's the same
 * browser-tab-strip pattern as switching/closing.
 */
export function PlanTabs({ activePlanName, onActivePlanNameChange }: PlanTabsProps) {
  const planOrder = useScenarioStore((s) => s.planOrder);
  const plans = useScenarioStore((s) => s.plans);
  const activePlanId = useScenarioStore((s) => s.activePlanId);
  const switchActivePlan = useScenarioStore((s) => s.switchActivePlan);
  const closePlan = useScenarioStore((s) => s.closePlan);
  const openPlanInNewTab = useScenarioStore((s) => s.openPlanInNewTab);
  const [editing, setEditing] = useState(false);

  const handleClose = (id: string, event: MouseEvent) => {
    event.stopPropagation();
    closePlan(id);
    void deletePlanRow(id);
  };

  return (
    <Tabs
      value={activePlanId}
      onChange={(id) => {
        if (!id) return;
        if (id === activePlanId) setEditing(true);
        else switchActivePlan(id);
      }}
      variant="outline"
    >
      <Tabs.List>
        {planOrder.map((id) =>
          id === activePlanId && editing ? (
            <TextInput
              key={id}
              aria-label="Plan name"
              placeholder="Name your plan"
              value={activePlanName}
              onChange={(e) => onActivePlanNameChange(e.currentTarget.value)}
              onBlur={() => setEditing(false)}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
              }}
              size="xs"
              w={160}
              autoFocus
            />
          ) : (
            <Tabs.Tab
              key={id}
              value={id}
              rightSection={
                planOrder.length > 1 ? (
                  <ActionIcon
                    component="span"
                    role="button"
                    tabIndex={0}
                    variant="transparent"
                    color="gray"
                    size="xs"
                    aria-label="Close plan"
                    onClick={(event) => handleClose(id, event)}
                  >
                    ×
                  </ActionIcon>
                ) : undefined
              }
            >
              {(id === activePlanId ? activePlanName : plans[id]?.name) || "Untitled plan"}
            </Tabs.Tab>
          ),
        )}
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label="New tab"
          onClick={() => openPlanInNewTab(null)}
          style={{ alignSelf: "center" }}
        >
          +
        </ActionIcon>
      </Tabs.List>
    </Tabs>
  );
}
