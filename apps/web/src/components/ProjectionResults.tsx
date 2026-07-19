import {
  penceToPounds,
  subtractPence,
  sumPence,
  totalTaxForYear,
  zeroPence,
  type Account,
  type Owner,
  type Pence,
  type Person,
  type ProjectionResult,
  type Scenario,
  type YearLedgerRow,
} from "@fp/engine";
import { Alert, Button, Center, Group, MultiSelect, Stack, Table, Text, Title, useComputedColorScheme } from "@mantine/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { downloadCsv, projectionToCsv } from "../csvExport.js";
import { formatMoney } from "../format.js";
import { computeNetWorth, computeProjection } from "../projection.js";

interface ChartMetric {
  readonly key: string;
  readonly label: string;
  /** A fixed colour per metric (not assigned by selection order) so a line's colour never shifts as other lines are added or removed. */
  readonly color: string;
  readonly compute: (row: YearLedgerRow) => number;
  /** Only set for a per-account metric — lets the year-by-year table pick out just the pension/ISA/GIA/cash balance columns without re-deriving account info from the key string. */
  readonly accountKind?: Account["kind"];
}

const CHART_METRICS: readonly ChartMetric[] = [
  { key: "netWorth", label: "Net worth", color: "#1c7ed6", compute: (row) => penceToPounds(computeNetWorth(row)) },
  {
    key: "grossIncome",
    label: "Gross income",
    color: "#0ca678",
    compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.grossIncome))),
  },
  {
    key: "netIncome",
    label: "Net income",
    color: "#2f9e44",
    compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.netIncome))),
  },
  { key: "totalTax", label: "Total tax", color: "#e03131", compute: (row) => penceToPounds(totalTaxForYear(row)) },
];

const ACCOUNT_LINE_COLORS = ["#7048e8", "#ae3ec9", "#f76707", "#1098ad", "#f08c00", "#e64980", "#4263eb", "#37b24d", "#fa5252", "#5c940d"];

/** A fixed pixel width per year-by-year table column (not a percentage) — keeps every column an identical, neatly-aligned width regardless of how many pension/ISA/GIA/cash balance columns get appended, with the table scrolling horizontally (its own wrapping `<div>`) rather than every column being squeezed illegibly narrow. */
const TABLE_COLUMN_WIDTH = 130;

interface TableColumn {
  readonly key: string;
  readonly label: string;
  readonly compute: (row: YearLedgerRow) => Pence;
  /** Shows a ⚠ next to the value — only the drawdown and net income columns use this, each keyed off a different shortfall flag than "the figure itself is negative." */
  readonly warningFlag?: (row: YearLedgerRow) => boolean;
  /** Whether this column is even relevant — hidden entirely (not just full of zeroes) when the user hasn't added the underlying income source/drain type at all. Omitted for a column that's always relevant regardless of scenario contents (the tax columns — there's no single catalog type to check for "any tax at all"). */
  readonly isIncluded?: (scenario: Scenario) => boolean;
}

interface TableColumnGroup {
  readonly label: string;
  /** A Mantine "light" colour token (theme-adaptive — automatically the right shade for light vs dark mode, unlike a fixed hex) — applied to both the header and every body cell in the group, so the colour-coding reads all the way down the table, not just at the top. */
  readonly bg: string;
  readonly columns: readonly TableColumn[];
}

const EXPENSE_DRAIN_TYPES = new Set(["livingExpenses", "oneOffOutflow", "mortgagePayment"]);
const CONTRIBUTION_DRAIN_TYPES = new Set(["isaContribution", "giaContribution", "cashContribution", "pensionContribution"]);

/**
 * The year-by-year table's column grouping (SPEC.md §7) — income sources
 * split into taxable vs non-taxable (each already tracked as its own
 * `PersonYearResult` field, so no engine change was needed: `grossIncome`
 * is earned/salary income specifically, `rentalProfitIncome` and
 * `statePensionIncome` are the other two taxable sources this engine
 * currently models, `taxFreeIncome` the one non-taxable one), then
 * outgoings, then drawdown income, then the tax columns, matching the
 * left-to-right reading order requested: what comes in (taxed, then
 * untaxed) → what goes out → what's drawn from savings/pensions → what's
 * paid in tax → the bottom-line net income/net worth.
 */
const TABLE_COLUMN_GROUPS: readonly TableColumnGroup[] = [
  {
    label: "Taxable income",
    bg: "var(--mantine-color-teal-light)",
    columns: [
      {
        key: "salary",
        label: "Salary",
        compute: (row) => sumPence(row.perPerson.map((p) => p.grossIncome)),
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "salary"),
      },
      {
        key: "rentalProfit",
        label: "Rental profit",
        compute: (row) => sumPence(row.perPerson.map((p) => p.rentalProfitIncome)),
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "rentalIncome"),
      },
      {
        key: "statePension",
        label: "State Pension",
        compute: (row) => sumPence(row.perPerson.map((p) => p.statePensionIncome)),
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "statePension"),
      },
    ],
  },
  {
    label: "Non-taxable income",
    bg: "var(--mantine-color-cyan-light)",
    columns: [
      {
        key: "taxFreeIncome",
        label: "Tax-free income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.taxFreeIncome)),
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "oneOffInflow"),
      },
    ],
  },
  {
    label: "Outgoings",
    bg: "var(--mantine-color-orange-light)",
    columns: [
      {
        key: "expenses",
        label: "Expenses",
        compute: (row) => sumPence(row.perPerson.map((p) => p.otherExpenses)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => EXPENSE_DRAIN_TYPES.has(d.type)),
      },
      {
        key: "contributions",
        label: "Contributions",
        compute: (row) => sumPence(row.perPerson.map((p) => p.accountContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => CONTRIBUTION_DRAIN_TYPES.has(d.type)),
      },
    ],
  },
  {
    label: "Drawdown",
    bg: "var(--mantine-color-grape-light)",
    columns: [
      {
        key: "drawdown",
        label: "Drawdown income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownNetAchieved)),
        warningFlag: (row) => row.perPerson.some((p) => p.drawdownShortfall),
        // The Retirement income target section is always present (SPEC.md
        // §5.7.1) with a £0 default — only counts as "included" once it's
        // actually been given a real target, not just because the
        // permanent section exists on the page.
        isIncluded: (scenario) =>
          scenario.incomeSources.some(
            (s) => s.type === "targetDrawdownIncome" && ((s.config as { readonly targetNetAnnualIncome?: number }).targetNetAnnualIncome ?? 0) > 0,
          ),
      },
    ],
  },
  {
    label: "Tax",
    bg: "var(--mantine-color-red-light)",
    columns: [
      {
        key: "incomeTax",
        label: "Income Tax",
        compute: (row) =>
          subtractPence(
            sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.drawdownIncomeTax, p.savingsTax, p.dividendTax])),
            sumPence(row.perPerson.map((p) => p.mortgageInterestCredit)),
          ),
      },
      {
        key: "cgt",
        label: "CGT",
        compute: (row) => sumPence(row.perPerson.flatMap((p) => [p.drawdownCapitalGainsTax, p.propertySaleCapitalGainsTax, p.shortfallCapitalGainsTax])),
      },
      { key: "ni", label: "NI", compute: (row) => sumPence(row.perPerson.map((p) => p.nationalInsurance)) },
    ],
  },
];

const NET_INCOME_COLUMN: TableColumn = {
  key: "netIncome",
  label: "Net income",
  compute: (row) => sumPence(row.perPerson.map((p) => p.netIncome)),
  warningFlag: (row) => row.perPerson.some((p) => p.livingExpensesShortfall),
};

const ACCOUNT_KIND_LABELS: Partial<Record<Account["kind"], string>> = { pension: "Pension", isa: "ISA", gia: "GIA", cash: "Cash" };

function ownerLabel(owner: Owner, people: readonly Person[]): string {
  if (owner === "joint") return "Joint";
  return people.findIndex((p) => p.id === owner) === 1 ? "Partner" : "You";
}

function accountBaseLabel(account: Account, people: readonly Person[]): string {
  // Only worth distinguishing "whose account is this" once there's more
  // than one person who could own it — a single-person household never
  // needs the suffix.
  const suffix = people.length > 1 ? ` (${ownerLabel(account.owner, people)})` : "";
  if (account.kind === "property") {
    return `${account.propertyType === "rental" ? "Rental" : "Main residence"} equity${suffix}`;
  }
  return `${ACCOUNT_KIND_LABELS[account.kind] ?? "Account"}${suffix}`;
}

/**
 * One selectable chart line per account (SPEC.md §4 journey 6/§7's
 * "bucket-balance graph" ask — seeing which specific pot is depleting,
 * before it's empty, not just after) — a per-*kind* aggregate would hide
 * exactly that: two pensions summed into one line can't show one running
 * out while the other still has headroom. A property's line tracks
 * equity (value minus its own mortgage), matching how net worth already
 * treats it, not raw market value. Colliding labels (e.g. two accounts
 * both landing on "Pension (You)") get a "#2", "#3", ... suffix so every
 * line in the picker is still unique.
 */
function buildAccountMetrics(scenario: Scenario): readonly ChartMetric[] {
  const { people } = scenario.household;
  const baseLabels = scenario.accounts.map((a) => accountBaseLabel(a, people));
  const totalByLabel = new Map<string, number>();
  for (const label of baseLabels) totalByLabel.set(label, (totalByLabel.get(label) ?? 0) + 1);
  const occurrenceSoFar = new Map<string, number>();

  return scenario.accounts.map((account, index) => {
    const baseLabel = baseLabels[index] ?? "Account";
    const occurrence = (occurrenceSoFar.get(baseLabel) ?? 0) + 1;
    occurrenceSoFar.set(baseLabel, occurrence);
    const label = (totalByLabel.get(baseLabel) ?? 0) > 1 ? `${baseLabel} #${occurrence}` : baseLabel;

    return {
      key: `account:${account.id}`,
      label,
      color: ACCOUNT_LINE_COLORS[index % ACCOUNT_LINE_COLORS.length] ?? "#868e96",
      accountKind: account.kind,
      compute: (row: YearLedgerRow) => {
        const balance = penceToPounds(row.accountBalances.get(account.id) ?? zeroPence());
        if (account.kind !== "property") return balance;
        return balance - penceToPounds(row.mortgageBalanceByPropertyId.get(account.id) ?? zeroPence());
      },
    };
  });
}

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

  const firstMpaaYear = result.rows.find((row) => row.perPerson.some((p) => p.mpaaActive));
  if (firstMpaaYear) {
    flags.push({
      taxYear: firstMpaaYear.taxYear,
      message: "The Money Purchase Annual Allowance is now active (a pension was flexibly accessed) — future pension contributions are capped at a lower allowance.",
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

  const firstLivingExpensesShortfallYear = result.rows.find((row) => row.perPerson.some((p) => p.livingExpensesShortfall));
  if (firstLivingExpensesShortfallYear) {
    flags.push({
      taxYear: firstLivingExpensesShortfallYear.taxYear,
      message: "Outgoings exceed income and available cash/ISA/GIA savings — the shortfall isn't fully covered.",
    });
  }

  return flags;
}

/**
 * The main-area results pane (SPEC.md §4 journey 2, §7): a minimal
 * net-worth chart and a year-by-year table, all figures in today's
 * money (real terms, SPEC.md §5.8/§7) since that's the engine's native
 * unit. Lives alongside the input sidebar (Onboarding.tsx's AppShell)
 * so edits are reflected here immediately, with no separate "submit"
 * step — `scenario` is null only when required inputs (a date of
 * birth) haven't been filled in yet.
 */
export function ProjectionResults({ scenario }: { readonly scenario: Scenario | null }) {
  const navigate = useNavigate();
  // A view preference, not part of the financial plan — kept as local
  // component state rather than on the Scenario, and starts with just
  // "Net worth" selected so the chart looks the same as before this line
  // picker existed.
  const [selectedMetrics, setSelectedMetrics] = useState<string[]>(["netWorth"]);

  const result = useMemo(() => (scenario ? computeProjection(scenario) : null), [scenario]);
  const keyFlags = useMemo(() => computeKeyFlags(result), [result]);
  const accountMetrics = useMemo(() => (scenario ? buildAccountMetrics(scenario) : []), [scenario]);
  const allMetrics = useMemo(() => [...CHART_METRICS, ...accountMetrics], [accountMetrics]);
  const balanceMetrics = useMemo(
    () => accountMetrics.filter((m) => m.accountKind === "pension" || m.accountKind === "isa" || m.accountKind === "gia" || m.accountKind === "cash"),
    [accountMetrics],
  );
  // Only columns for income sources/drains actually present in the
  // scenario — a column of nothing but zeroes for a catalog type the
  // user never added is noise, not information. Groups left with no
  // visible columns at all (e.g. no taxable income of any kind) drop out
  // entirely too, rather than showing an empty coloured header for nothing.
  const visibleColumnGroups = useMemo(
    () =>
      scenario
        ? TABLE_COLUMN_GROUPS.map((group) => ({
            ...group,
            columns: group.columns.filter((c) => (c.isIncluded ? c.isIncluded(scenario) : true)),
          })).filter((group) => group.columns.length > 0)
        : [],
    [scenario],
  );

  // Seeds the chart with each pension/ISA/GIA/cash balance line the first
  // time its own account appears — knowing how each pot tracks over time
  // is important enough to show without an extra click. `ProjectionResults`
  // is a long-lived component that never remounts as accounts are added
  // (Onboarding.tsx just passes it an updated `scenario` prop each edit,
  // typically well after this component's first mount, before a date of
  // birth is even filled in) — so a `useState` initializer alone can only
  // ever see whatever existed at that first instant, never accounts added
  // afterward. Tracks every key already seen (not just "seeded at all
  // once") so a *second* account added later still gets its own default
  // line — the earlier one-shot-flag version of this effect only ever
  // caught the very first account, since it marked itself done before
  // any of the rest existed. Only ever adds newly-appeared keys, never
  // re-adds one the user has since deselected.
  const seenBalanceMetricKeysRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const newKeys = balanceMetrics.map((m) => m.key).filter((key) => !seenBalanceMetricKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    for (const key of newKeys) seenBalanceMetricKeysRef.current.add(key);
    setSelectedMetrics((prev) => [...new Set([...prev, ...newKeys])]);
  }, [balanceMetrics]);
  // Recharts renders plain SVG and doesn't pick up Mantine's colour scheme on
  // its own — without this, axis/grid colours stay locked to a light-mode
  // palette and become close to unreadable against a dark background.
  const colorScheme = useComputedColorScheme("light");

  if (!scenario || !result) {
    return (
      <Center h="100%" mih={400}>
        <Text c="dimmed">Add your date of birth to see your projection.</Text>
      </Center>
    );
  }

  const isDark = colorScheme === "dark";
  const chartTextColor = isDark ? "#C1C2C5" : "#495057";
  const chartGridColor = isDark ? "#373A40" : "#e9ecef";
  const chartData = result.rows.map((row) => ({
    taxYear: row.taxYear,
    ...Object.fromEntries(allMetrics.map((m) => [m.key, m.compute(row)])),
  }));
  const visibleMetrics = allMetrics.filter((m) => selectedMetrics.includes(m.key));

  return (
    <Stack gap="xl">
      <Group justify="space-between">
        <Title order={2}>Your projection</Title>
        <Group gap="xs">
          <Button variant="subtle" onClick={() => downloadCsv(projectionToCsv(result))}>
            Export report
          </Button>
          <Button variant="subtle" onClick={() => void navigate("/tax-breakdown")}>
            Tax breakdown
          </Button>
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

      <MultiSelect
        label="Lines to show"
        data={[
          { group: "Summary", items: CHART_METRICS.map((m) => ({ value: m.key, label: m.label })) },
          ...(accountMetrics.length > 0
            ? [{ group: "Account balances", items: accountMetrics.map((m) => ({ value: m.key, label: m.label })) }]
            : []),
        ]}
        value={selectedMetrics}
        onChange={setSelectedMetrics}
        maw={480}
      />

      <div style={{ height: 300 }}>
        {visibleMetrics.length === 0 ? (
          <Center h="100%">
            <Text c="dimmed">Select at least one line above to show a chart.</Text>
          </Center>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 10, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
              <XAxis
                dataKey="taxYear"
                tickFormatter={(v: string) => v.split("-")[0] ?? v}
                tick={{ fill: chartTextColor }}
                stroke={chartGridColor}
              />
              <YAxis
                width={90}
                tickFormatter={(v: number) => `£${v.toLocaleString()}`}
                tick={{ fill: chartTextColor }}
                stroke={chartGridColor}
              />
              <Tooltip
                formatter={(v: number) => `£${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`}
                contentStyle={{ backgroundColor: isDark ? "#25262B" : "#fff", borderColor: chartGridColor, color: chartTextColor }}
              />
              <Legend wrapperStyle={{ color: chartTextColor }} />
              {visibleMetrics.map((m) => (
                <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      <Title order={4}>Year by year</Title>
      <Text size="sm" c="dimmed">
        Income sources on the left (taxable, then non-taxable), then outgoings, drawdown income, and tax — each
        section colour-coded — followed by net income and net worth. Pension/ISA/GIA/cash balance columns at the far
        right show each individual account (SPEC.md §7), the same figures the chart&rsquo;s &ldquo;Account
        balances&rdquo; lines above plot.
      </Text>
      <div style={{ overflowX: "auto" }}>
        <Table
          striped
          withTableBorder
          withColumnBorders
          style={{ tableLayout: "fixed" }}
          ff="monospace"
          miw={TABLE_COLUMN_WIDTH * (1 + visibleColumnGroups.reduce((n, g) => n + g.columns.length, 0) + 2 + balanceMetrics.length)}
        >
          <Table.Thead>
            <Table.Tr>
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2}>
                Tax year
              </Table.Th>
              {visibleColumnGroups.map((group) => (
                <Table.Th key={group.label} colSpan={group.columns.length} bg={group.bg} ta="center">
                  {group.label}
                </Table.Th>
              ))}
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2}>
                Net income
              </Table.Th>
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2} bg="var(--mantine-color-blue-light)">
                Net worth
              </Table.Th>
              {balanceMetrics.length > 0 && (
                <Table.Th colSpan={balanceMetrics.length} ta="center">
                  Account balances
                </Table.Th>
              )}
            </Table.Tr>
            <Table.Tr>
              {visibleColumnGroups.flatMap((group) =>
                group.columns.map((column) => (
                  <Table.Th key={column.key} w={TABLE_COLUMN_WIDTH} bg={group.bg}>
                    {column.label}
                  </Table.Th>
                )),
              )}
              {balanceMetrics.map((m) => (
                <Table.Th key={m.key} w={TABLE_COLUMN_WIDTH}>
                  {m.label}
                </Table.Th>
              ))}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.rows.map((row) => {
              const netWorth = computeNetWorth(row);
              return (
                <Table.Tr key={row.taxYear}>
                  <Table.Td>{row.taxYear}</Table.Td>
                  {visibleColumnGroups.flatMap((group) =>
                    group.columns.map((column) => (
                      <Table.Td key={column.key} bg={group.bg} ta="right">
                        {formatMoney(column.compute(row))}
                        {column.warningFlag?.(row) ? " ⚠" : ""}
                      </Table.Td>
                    )),
                  )}
                  <Table.Td ta="right">
                    {formatMoney(NET_INCOME_COLUMN.compute(row))}
                    {NET_INCOME_COLUMN.warningFlag?.(row) ? " ⚠" : ""}
                  </Table.Td>
                  <Table.Td bg="var(--mantine-color-blue-light)" fw={600} ta="right">
                    {formatMoney(netWorth)}
                  </Table.Td>
                  {balanceMetrics.map((m) => (
                    <Table.Td key={m.key} ta="right">
                      £{m.compute(row).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </Table.Td>
                  ))}
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
