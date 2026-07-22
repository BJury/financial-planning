import { registry, type IncomeDrainDefinition, type IncomeSourceDefinition } from "@fp/engine";
import { Button, Menu, Stack, Text } from "@mantine/core";

export interface CatalogPickerProps {
  readonly kind: "source" | "drain";
  readonly onSelect: (type: string) => void;
  /** Registry types to hide from this picker — e.g. `targetDrawdownIncome`, which has its own permanent, always-present section instead of being picked from here (SPEC.md §5.7.1's "the most important input" is promoted out of the generic optional-extras list). Mutually exclusive with `includeTypes` — a picker only ever needs one side of the filter. */
  readonly excludeTypes?: readonly string[];
  /** The inverse of `excludeTypes` — when set, only these registry types are offered, e.g. the Contributions picker pulling just the four account-crediting drain types out of the wider drain registry (SPEC.md §9.4 still covers all of them as one catalog; this only affects which subset a given picker surfaces). */
  readonly includeTypes?: readonly string[];
  /** Overrides the default kind-based label (e.g. "Contributions" pulling its items from the `"drain"` registry but not wanting to be labelled "+ Add drain"). */
  readonly label?: string;
}

/**
 * The "+ Add income source" / "+ Add drain" picker (SPEC.md §3.11, §4
 * journey 1) — generated directly from the registry, so it never needs
 * updating when a new catalog type is added in a later phase (SPEC.md
 * §9.4).
 */
export function CatalogPicker({ kind, onSelect, excludeTypes = [], includeTypes, label }: CatalogPickerProps) {
  const definitions: readonly (IncomeSourceDefinition<unknown> | IncomeDrainDefinition<unknown>)[] = (
    kind === "source" ? registry.listIncomeSources() : registry.listIncomeDrains()
  ).filter((def) => (includeTypes ? includeTypes.includes(def.type) : !excludeTypes.includes(def.type)));

  return (
    <Menu shadow="md" position="bottom-start">
      <Menu.Target>
        <Button variant="light">{label ?? (kind === "source" ? "+ Add income source" : "+ Add drain")}</Button>
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
