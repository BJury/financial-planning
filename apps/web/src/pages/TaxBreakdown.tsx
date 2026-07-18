import { sumPence, type Pence, type PersonYearResult } from "@fp/engine";
import { Alert, Button, Card, Group, Select, Stack, Table, Text, Title } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { formatMoney, formatPercent } from "../format.js";
import { computeProjection } from "../projection.js";
import { useScenarioStore } from "../state/store.js";

const BAND_LABELS: Record<string, string> = {
  personalAllowance: "Personal Allowance",
  basic: "Basic rate",
  higher: "Higher rate",
  additional: "Additional rate",
};

const BUCKET_LABELS: Record<string, string> = {
  taxFreeISA: "ISA (tax-free)",
  taxFreePensionLumpSum: "Pension tax-free cash",
  taxFreeCashPrincipal: "Cash principal (tax-free)",
  taxFreeGIAReturnOfCapital: "GIA return of capital (tax-free)",
  taxablePersonalAllowance: "Pension income — within Personal Allowance",
  taxableBasicRate: "Pension income — basic rate",
  taxableHigherRate: "Pension income — higher rate",
  taxableAdditionalRate: "Pension income — additional rate",
  capitalGainWithinAllowance: "GIA gain — within CGT allowance",
  capitalGainTaxable: "GIA gain — taxable",
};

/**
 * SPEC.md §4 journey 5: for any given year, show exactly how tax was
 * calculated — every figure here is read directly from the same
 * `runProjection` result Dashboard renders (SPEC.md §9.1: derived, never
 * separately computed), so this view exists specifically to let the
 * numbers be cross-checked against each other and hand-verified.
 */
export function TaxBreakdown() {
  const scenario = useScenarioStore((s) => s.scenario);
  const navigate = useNavigate();

  const result = useMemo(() => (scenario ? computeProjection(scenario) : null), [scenario]);
  const [selectedTaxYear, setSelectedTaxYear] = useState<string | null>(null);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  const rows = result?.rows ?? [];
  const row = rows.find((r) => r.taxYear === selectedTaxYear) ?? rows[0];

  return (
    <Stack maw={720} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Tax breakdown</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" onClick={() => void navigate("/dashboard")}>
            Back to projection
          </Button>
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Exactly how this year&rsquo;s tax was calculated, for cross-checking against the year-by-year table on the
        projection page — every total here sums up from the same figures shown there (SPEC.md §4 journey 5).
      </Alert>

      <Select
        label="Tax year"
        data={rows.map((r) => r.taxYear)}
        value={row?.taxYear ?? null}
        onChange={setSelectedTaxYear}
        allowDeselect={false}
      />

      {row?.perPerson.map((person) => <PersonBreakdown key={person.personId} person={person} />)}
    </Stack>
  );
}

function PersonBreakdown({ person }: { readonly person: PersonYearResult }) {
  const totalTax = sumPence([
    person.incomeTax,
    person.nationalInsurance,
    person.annualAllowanceCharge,
    person.drawdownIncomeTax,
    person.drawdownCapitalGainsTax,
    person.savingsTax,
    person.dividendTax,
  ]);

  return (
    <Stack gap="lg">
      <Section title="Income Tax">
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Band</Table.Th>
              <Table.Th>Rate</Table.Th>
              <Table.Th>Taxable amount</Table.Th>
              <Table.Th>Tax</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {person.incomeTaxByBand.map((band) => (
              <Table.Tr key={band.name}>
                <Table.Td>{BAND_LABELS[band.name] ?? band.name}</Table.Td>
                <Table.Td>{formatPercent(band.rate)}</Table.Td>
                <Table.Td>{formatMoney(band.taxableAmount)}</Table.Td>
                <Table.Td>{formatMoney(band.tax)}</Table.Td>
              </Table.Tr>
            ))}
            <TotalRow label="Total Income Tax on earned/pension income" amount={person.incomeTax} colSpan={3} />
          </Table.Tbody>
        </Table>
      </Section>

      <Section title="National Insurance">
        <KeyValue label="National Insurance" amount={person.nationalInsurance} />
      </Section>

      {(person.grossPensionContribution > 0 || person.pensionInputAmount > 0 || person.annualAllowanceCharge > 0) && (
        <Section title="Pension relief and Annual Allowance">
          {person.grossPensionContribution > 0 && (
            <KeyValue
              label="Relief-at-source contribution, grossed up"
              amount={person.grossPensionContribution}
              description="This extends the basic/higher rate band ceilings — it's why the Income Tax bands above may show more taxed at a lower rate than the gross income alone would suggest."
            />
          )}
          <KeyValue label="Total pension input this year (the Annual Allowance test figure)" amount={person.pensionInputAmount} />
          {person.annualAllowanceCharge > 0 && (
            <KeyValue
              label="Annual Allowance charge"
              amount={person.annualAllowanceCharge}
              description="Contributions exceeded the available Annual Allowance (including any carried-forward headroom) — the excess is charged back at your marginal rate."
            />
          )}
        </Section>
      )}

      {(person.savingsInterestIncome > 0 || person.dividendIncome > 0) && (
        <Section title="Savings and dividend tax">
          {person.savingsInterestIncome > 0 && (
            <>
              <KeyValue label="Cash interest (before tax)" amount={person.savingsInterestIncome} />
              <KeyValue label="Tax on interest (via the Personal Savings Allowance)" amount={person.savingsTax} />
            </>
          )}
          {person.dividendIncome > 0 && (
            <>
              <KeyValue label="GIA dividends (before tax)" amount={person.dividendIncome} />
              <KeyValue label="Tax on dividends (via the Dividend Allowance)" amount={person.dividendTax} />
            </>
          )}
        </Section>
      )}

      {person.drawdownBuckets.length > 0 && (
        <Section title="Drawdown">
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Bucket</Table.Th>
                <Table.Th>Amount drawn</Table.Th>
                <Table.Th>Tax cost</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {person.drawdownBuckets.map((bucket) => (
                <Table.Tr key={bucket.bucket}>
                  <Table.Td>{BUCKET_LABELS[bucket.bucket] ?? bucket.bucket}</Table.Td>
                  <Table.Td>{formatMoney(bucket.amount)}</Table.Td>
                  <Table.Td>{formatMoney(bucket.taxCost)}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
          <KeyValue label="Total drawn (gross, all accounts)" amount={person.drawdownGrossWithdrawn} />
          <KeyValue label="Net achieved against the target" amount={person.drawdownNetAchieved} />
          {person.drawdownShortfall && (
            <Text size="sm" c="orange.7">
              ⚠ The target wasn&rsquo;t fully met this year — available balances ran out.
            </Text>
          )}
        </Section>
      )}

      {(person.taxFreeIncome > 0 || person.otherExpenses > 0 || person.surplusSweptToIsa > 0 || person.surplusSweptToGia > 0) && (
        <Section title="Other cash flows">
          {person.taxFreeIncome > 0 && <KeyValue label="Tax-free income (e.g. a one-off inheritance)" amount={person.taxFreeIncome} />}
          {person.otherExpenses > 0 && <KeyValue label="Living expenses and one-off outflows" amount={person.otherExpenses} />}
          {person.surplusSweptToIsa > 0 && (
            <KeyValue label="Surplus cash swept into the ISA" amount={person.surplusSweptToIsa} />
          )}
          {person.surplusSweptToGia > 0 && (
            <KeyValue label="Surplus cash swept into the GIA" amount={person.surplusSweptToGia} />
          )}
        </Section>
      )}

      <Section title="Summary">
        <KeyValue label="Total tax (all types combined)" amount={totalTax} bold />
        <KeyValue label="Net income" amount={person.netIncome} bold />
      </Section>
    </Stack>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <Card withBorder padding="md">
      <Title order={4} mb="sm">
        {title}
      </Title>
      <Stack gap="xs">{children}</Stack>
    </Card>
  );
}

function KeyValue({
  label,
  amount,
  description,
  bold,
}: {
  readonly label: string;
  readonly amount: Pence;
  readonly description?: string;
  readonly bold?: boolean;
}) {
  return (
    <div>
      <Group justify="space-between">
        <Text size="sm" fw={bold ? 700 : 400}>
          {label}
        </Text>
        <Text size="sm" fw={bold ? 700 : 400}>
          {formatMoney(amount)}
        </Text>
      </Group>
      {description && (
        <Text size="xs" c="dimmed">
          {description}
        </Text>
      )}
    </div>
  );
}

function TotalRow({ label, amount, colSpan }: { readonly label: string; readonly amount: Pence; readonly colSpan: number }) {
  return (
    <Table.Tr>
      <Table.Td colSpan={colSpan}>
        <Text fw={700}>{label}</Text>
      </Table.Td>
      <Table.Td>
        <Text fw={700}>{formatMoney(amount)}</Text>
      </Table.Td>
    </Table.Tr>
  );
}
