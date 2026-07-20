import { Anchor, Button, List, Modal, Stack, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

const GITHUB_ISSUES_URL = "https://github.com/BJury/financial-planning/issues";

/**
 * A brief "what is this" for a first-time visitor, plus a link to file
 * bugs/requests — there's no in-app feedback mechanism otherwise, and
 * GitHub Issues is where this project's own work is already tracked
 * (SPEC.md isn't visitor-facing).
 */
export function AboutDialog() {
  const [opened, { open, close }] = useDisclosure(false);

  return (
    <>
      <Button variant="subtle" size="xs" onClick={open}>
        About
      </Button>
      <Modal opened={opened} onClose={close} title="About Can I Stop" size="md">
        <Stack gap="sm">
          <Text size="sm">
            Can I Stop is a UK retirement-planning calculator: it projects your accounts — pensions, ISAs, GIAs, cash, and property — year by
            year, applying UK Income Tax, National Insurance, and Capital Gains Tax rules, to estimate whether your money lasts as long as you
            need it to.
          </Text>
          <List size="sm" spacing={4}>
            <List.Item>Everything runs in your browser — your numbers are never sent anywhere or stored on a server.</List.Item>
            <List.Item>Figures are shown in today&rsquo;s money (inflation-adjusted throughout).</List.Item>
            <List.Item>
              A drawdown solver works out how much to withdraw each year, from which accounts, to hit your target income as tax-efficiently as
              possible.
            </List.Item>
            <List.Item>The stress test page flexes growth and inflation assumptions to check how sensitive your plan is to bad years.</List.Item>
          </List>
          <Text size="sm" c="dimmed">
            It&rsquo;s a personal project, not financial advice — figures are estimates and may be wrong.
          </Text>
          <Text size="sm">
            Found a bug, or have a feature request?{" "}
            <Anchor href={GITHUB_ISSUES_URL} target="_blank" rel="noopener noreferrer">
              Raise it on GitHub
            </Anchor>
            .
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
