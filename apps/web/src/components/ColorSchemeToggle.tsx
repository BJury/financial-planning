import { Button, useComputedColorScheme, useMantineColorScheme } from "@mantine/core";

/**
 * Defaults to the OS preference (`MantineProvider defaultColorScheme="auto"`
 * in App.tsx) and persists an explicit override to localStorage — Mantine's
 * own `colorSchemeManager` handles that persistence, no app code needed.
 * `useComputedColorScheme` resolves "auto" to a concrete light/dark for the
 * button label; `toggleColorScheme` flips between the two concrete values.
 */
export function ColorSchemeToggle() {
  const computedColorScheme = useComputedColorScheme("light");
  const { toggleColorScheme } = useMantineColorScheme();

  return (
    <Button variant="subtle" size="xs" onClick={toggleColorScheme}>
      {computedColorScheme === "dark" ? "Light mode" : "Dark mode"}
    </Button>
  );
}
