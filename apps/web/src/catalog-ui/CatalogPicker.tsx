import { registry, type IncomeDrainDefinition, type IncomeSourceDefinition } from "@fp/engine";
import { Button, Menu, Stack, Text } from "@mantine/core";

export interface CatalogPickerProps {
  readonly kind: "source" | "drain";
  readonly onSelect: (type: string) => void;
}

/**
 * The "+ Add income source" / "+ Add drain" picker (SPEC.md §3.11, §4
 * journey 1) — generated directly from the registry, so it never needs
 * updating when a new catalog type is added in a later phase (SPEC.md
 * §9.4).
 */
export function CatalogPicker({ kind, onSelect }: CatalogPickerProps) {
  const definitions: readonly (IncomeSourceDefinition<unknown> | IncomeDrainDefinition<unknown>)[] =
    kind === "source" ? registry.listIncomeSources() : registry.listIncomeDrains();

  return (
    <Menu shadow="md" position="bottom-start">
      <Menu.Target>
        <Button variant="light">{kind === "source" ? "+ Add income source" : "+ Add drain"}</Button>
      </Menu.Target>
      <Menu.Dropdown>
        {definitions.map((def) => (
          <Menu.Item key={def.type} onClick={() => onSelect(def.type)}>
            <Stack gap={0}>
              <Text size="sm">{def.displayName}</Text>
              <Text size="xs" c="dimmed">
                {def.description}
              </Text>
            </Stack>
          </Menu.Item>
        ))}
      </Menu.Dropdown>
    </Menu>
  );
}
