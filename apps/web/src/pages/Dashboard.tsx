import { penceToPounds, subtractPence, sumPence, type ProjectionResult } from "@fp/engine";
import { Alert, Button, Group, Stack, Table, Text, Title, useComputedColorScheme } from "@mantine/core";
import { useMemo } from "react";
import { Navigate, useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { downloadCsv, projectionToCsv } from "../csvExport.js";
import { formatMoney } from "../format.js";
import { computeNetWorth, computeProjection } from "../projection.js";
import { useScenarioStore } from "../state/store.js";

interface KeyFlag {
  readonly taxYear: string;
  readonly message: string;
}

/**
 * SPEC.md §7's "key flags/warnings" — surfaced once, summarised across
 * the whole plan, rather than requiring the user to scan every row of
 * the year-by-year table for a ⚠. Only the *first* occurrence of each
 * kind is shown per warning type, since a recurring condition (e.g. a
 * shortfall every year from age 80 onward) is one decision to revisit,
 * not dozens of identical lines.
 */
function computeKeyFlags(result: ProjectionResult | null): readonly KeyFlag[] {
  if (!result) return [];
  const flags: KeyFlag[] = [];

  const firstAnnualAllowanceYear = result.rows.find((row) => row.perPerson.some((p) => p.annualAllowanceCharge > 0));
  if (firstAnnualAllowanceYear) {
    flags.push({
      taxYear: firstAnnualAllowanceYear.taxYear,
      message: "Pension contributions exceed the Annual Allowance, triggering a tax charge.",
    });
  }

  const firstShortfallYear = result.rows.find((row) => row.perPerson.some((p) => p.drawdownShortfall));
  if (firstShortfallYear) {
    flags.push({
      taxYear: firstShortfallYear.taxYear,
      message: "A drawdown target isn't fully met — available balances run out before the target is reached.",
    });
  }

  const firstNegativeEquityYear = result.rows.find((row) => row.perPerson.some((p) => p.propertySaleNetProceeds < 0));
  if (firstNegativeEquityYear) {
    flags.push({
      taxYear: firstNegativeEquityYear.taxYear,
      message: "A property sale's net proceeds are negative — the outstanding mortgage exceeds the sale price after costs and tax.",
    });
  }

  return flags;
}

/**
 * Phase 1's dashboard (SPEC.md §4 journey 2, §7): a minimal net-worth
 * chart and a year-by-year table, all figures in today's money (real
 * terms, SPEC.md §5.8/§7) since that's the engine's native unit.
 */
export function Dashboard() {
  const scenario = useScenarioStore((s) => s.scenario);
  const navigate = useNavigate();

  const result = useMemo(() => (scenario ? computeProjection(scenario) : null), [scenario]);
  const keyFlags = useMemo(() => computeKeyFlags(result), [result]);
  // Recharts renders plain SVG and doesn't pick up Mantine's colour scheme on
  // its own — without this, axis/grid colours stay locked to a light-mode
  // palette and become close to unreadable against a dark background.
  const colorScheme = useComputedColorScheme("light");

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  const chartData = (result?.rows ?? []).map((row) => ({ taxYear: row.taxYear, netWorth: penceToPounds(computeNetWorth(row)) }));
  const isDark = colorScheme === "dark";
  const chartTextColor = isDark ? "#C1C2C5" : "#495057";
  const chartGridColor = isDark ? "#373A40" : "#e9ecef";

  return (
    <Stack maw={720} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Your projection</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" onClick={() => result && downloadCsv(projectionToCsv(result))} disabled={!result}>
            Export report
          </Button>
          <Button variant="subtle" onClick={() => void navigate("/tax-breakdown")}>
            Tax breakdown
          </Button>
          <Button variant="subtle" onClick={() => void navigate("/")}>
            Edit plan
          </Button>
          <ColorSchemeToggle />
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Illustrative projection only, not financial advice — figures are in today&rsquo;s money (SPEC.md §0, §5.8).
      </Alert>

      {keyFlags.length > 0 && (
        <Alert color="orange" variant="light" title="Key flags">
          <Stack gap={4}>
            {keyFlags.map((flag) => (
              <Text size="sm" key={flag.message}>
                <Text span fw={600}>
                  {flag.taxYear}:
                </Text>{" "}
                {flag.message}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
            <XAxis dataKey="taxYear" tick={{ fill: chartTextColor }} stroke={chartGridColor} />
            <YAxis tickFormatter={(v: number) => `£${v.toLocaleString()}`} tick={{ fill: chartTextColor }} stroke={chartGridColor} />
            <Tooltip
              formatter={(v: number) => `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
              contentStyle={{ backgroundColor: isDark ? "#25262B" : "#fff", borderColor: chartGridColor, color: chartTextColor }}
            />
            <Legend wrapperStyle={{ color: chartTextColor }} />
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
            <Table.Th>Drawdown income</Table.Th>
            <Table.Th>Income Tax</Table.Th>
            <Table.Th>CGT</Table.Th>
            <Table.Th>NI</Table.Th>
            <Table.Th>Net income</Table.Th>
            <Table.Th>Net worth</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {(result?.rows ?? []).map((row) => {
            const netWorth = computeNetWorth(row);
            // Household-combined figures (SPEC.md §5.1: each person's own
            // tax is computed independently, but this table shows the
            // whole household's cash flow for the year) — the Tax
            // Breakdown page shows each person's own figures separately.
            const grossIncome = sumPence(row.perPerson.map((p) => p.grossIncome));
            const drawdownNetAchieved = sumPence(row.perPerson.map((p) => p.drawdownNetAchieved));
            const drawdownShortfall = row.perPerson.some((p) => p.drawdownShortfall);
            const incomeTax = subtractPence(
              sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.drawdownIncomeTax, p.savingsTax, p.dividendTax])),
              sumPence(row.perPerson.map((p) => p.mortgageInterestCredit)),
            );
            const cgt = sumPence(row.perPerson.flatMap((p) => [p.drawdownCapitalGainsTax, p.propertySaleCapitalGainsTax]));
            const nationalInsurance = sumPence(row.perPerson.map((p) => p.nationalInsurance));
            const netIncome = sumPence(row.perPerson.map((p) => p.netIncome));
            return (
              <Table.Tr key={row.taxYear}>
                <Table.Td>{row.taxYear}</Table.Td>
                <Table.Td>{formatMoney(grossIncome)}</Table.Td>
                <Table.Td>
                  {formatMoney(drawdownNetAchieved)}
                  {drawdownShortfall ? " ⚠" : ""}
                </Table.Td>
                <Table.Td>{formatMoney(incomeTax)}</Table.Td>
                <Table.Td>{formatMoney(cgt)}</Table.Td>
                <Table.Td>{formatMoney(nationalInsurance)}</Table.Td>
                <Table.Td>{formatMoney(netIncome)}</Table.Td>
                <Table.Td>{formatMoney(netWorth)}</Table.Td>
              </Table.Tr>
            );
          })}
        </Table.Tbody>
      </Table>
    </Stack>
  );
}
