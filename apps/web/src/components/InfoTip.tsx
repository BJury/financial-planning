import { ActionIcon, Popover, Text } from "@mantine/core";
import type { ReactNode } from "react";

/**
 * A small "?" that reveals extra detail on click, not hover — this needs
 * to work on touch devices, and some of the detail runs a sentence or
 * two longer than a hover tooltip comfortably holds. Used next to a
 * section/card title, or inside a Mantine input's `label` (which already
 * accepts a `ReactNode`) in place of a long `description` prop.
 */
export function InfoTip({ children }: { readonly children: ReactNode }) {
  return (
    <Popover width={280} withArrow shadow="md" position="top-start">
      <Popover.Target>
        <ActionIcon variant="subtle" color="gray" size="sm" radius="xl" aria-label="More information">
          ?
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Text size="sm">{children}</Text>
      </Popover.Dropdown>
    </Popover>
  );
}
