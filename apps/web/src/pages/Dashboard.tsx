import { getLatestConfirmedRuleSet, penceToPounds, runProjection, sumPence, type Pence } from "@fp/engine";
import { Alert, Button, Group, Stack, Table, Title } from "@mantine/core";
import { useMemo } from "react";
import { Navigate, useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useScenarioStore } from "../state/store.js";

const PROJECTION_YEARS = 5;

/**
 * Phase 1's dashboard (SPEC.md §4 journey 2, §7): a minimal net-worth
 * chart and a year-by-year table, all figures in today's money (real
 * terms, SPEC.md §5.8/§7) since that's the engine's native unit.
 */
export function Dashboard() {
  const scenario = useScenarioStore((s) => s.scenario);
  const navigate = useNavigate();

  const result = useMemo(() => {
    if (!scenario) return null;
    return runProjection(scenario, getLatestConfirmedRuleSet(), PROJECTION_YEARS);
  }, [scenario]);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  const chartData = (result?.rows ?? []).map((row) => {
    const netWorth = sumPence([...row.accountBalances.values()]);
    return { taxYear: row.taxYear, netWorth: penceToPounds(netWorth) };
  });

  return (
    <Stack maw={720} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Your projection</Title>
        <Button variant="subtle" onClick={() => void navigate("/")}>
          Edit plan
        </Button>
      </Group>

      <Alert color="blue" variant="light">
        Illustrative projection only, not financial advice — figures are in today&rsquo;s money (SPEC.md §0, §5.8).
      </Alert>

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="taxYear" />
            <YAxis tickFormatter={(v: number) => `£${v.toLocaleString()}`} />
            <Tooltip formatter={(v: number) => `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`} />
            <Legend />
            <Line type="monotone" dataKey="netWorth" name="Net worth" stroke="#1c7ed6" strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <Title order={4}>Year by year</Title>
      <Table striped withTableBorder>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Tax year</Table.Th>
            <Table.Th>Gross income</Table.Th>
            <Table.Th>Income Tax</Table.Th>
            <Table.Th>NI</Table.Th>
            <Table.Th>Net income</Table.Th>
            <Table.Th>Net worth</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(result?.rows ?? []).map((row) => {
            const person = row.perPerson[0];
            const netWorth = sumPence([...row.accountBalances.values()]);
            return (
              <Table.Tr key={row.taxYear}>
                <Table.Td>{row.taxYear}</Table.Td>
                <Table.Td>{formatMoney(person?.grossIncome)}</Table.Td>
                <Table.Td>{formatMoney(person?.incomeTax)}</Table.Td>
                <Table.Td>{formatMoney(person?.nationalInsurance)}</Table.Td>
                <Table.Td>{formatMoney(person?.netIncome)}</Table.Td>
                <Table.Td>{formatMoney(netWorth)}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}

function formatMoney(amount: Pence | undefined): string {
  if (amount === undefined) return "—";
  return `£${penceToPounds(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
