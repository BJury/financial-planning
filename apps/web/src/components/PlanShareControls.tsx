import type { Scenario } from "@fp/engine";
import { Button, TextInput } from "@mantine/core";
import { useState } from "react";
import { buildShareUrl } from "../persistence/shareLink.js";
import { InfoTip } from "./InfoTip.js";

/**
 * Derives a safe filename from the scenario's own (optional) `name` —
 * strips characters that are invalid across Windows/macOS/Linux
 * filesystems rather than just the ones any one OS happens to reject, so
 * the same export behaves the same way regardless of where it's later
 * opened. Falls back to the previous fixed filename when unset or when
 * sanitising leaves nothing usable. Also used by `Onboarding.tsx`'s "Save
 * to file" button, which lives alongside the other plan/tab-management
 * actions rather than here — see this file's own doc comment below.
 */
export function filenameForScenario(name: string | undefined): string {
  const sanitised = (name ?? "").replace(/[/\\:*?"<>|]/g, " ").replace(/\s+/g, " ").trim();
  return sanitised ? `${sanitised}.json` : "retirement-plan.json";
}

/**
 * "Share link" (SPEC.md §9.2) — only meaningful once there's an actual
 * plan to share, so this renders inside `ProjectionResults`'s own header,
 * alongside its other projection-scoped actions (Export report, Tax
 * breakdown, ...). "Save to file" and "Open from file" moved to
 * `Onboarding.tsx`'s plan/tab-management button row instead, since (unlike
 * sharing) they're a symmetric pair that both move the scenario to/from
 * your own filesystem, not to another person.
 */
export function PlanShareControls({ scenario }: { readonly scenario: Scenario }) {
  // "copied" is a transient self-resetting label, not persisted state —
  // matches this app's existing no-notification-library feedback style.
  // "manual" is the fallback for when the Clipboard API itself is
  // unavailable or blocked (e.g. a non-secure context, or a permission
  // denial), showing the link in a selectable field instead of failing
  // silently.
  const [shareState, setShareState] = useState<"idle" | "copied" | "manual">("idle");
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const handleShare = async () => {
    const url = await buildShareUrl(scenario);
    try {
      await navigator.clipboard.writeText(url);
      setShareState("copied");
      setTimeout(() => setShareState("idle"), 2000);
    } catch {
      setShareUrl(url);
      setShareState("manual");
    }
  };

  return (
    <>
      <Button variant="default" size="xs" onClick={() => void handleShare()}>
        {shareState === "copied" ? "Copied!" : "Share link"}
      </Button>
      <InfoTip>A share link contains your full plan, including balances — only share it with people you trust.</InfoTip>
      {shareState === "manual" && shareUrl && (
        <TextInput size="xs" w={280} value={shareUrl} readOnly onFocus={(event) => event.currentTarget.select()} />
      )}
    </>
  );
}
