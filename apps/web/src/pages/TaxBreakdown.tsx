import {
  subtractPence,
  sumPence,
  totalTaxForYear,
  type HouseholdDrawdownSplitStrategy,
  type IncomeSourceInstance,
  type Pence,
  type PersonYearResult,
  type Scenario,
  type TargetDrawdownIncomeConfig,
} from "@fp/engine";
import { Alert, Button, Card, Group, Select, Stack, Table, Text, Title } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { formatMoney, formatPercent } from "../format.js";
import { computeProjection } from "../projection.js";
import { useScenarioStore } from "../state/store.js";

const STRATEGY_LABELS: Record<HouseholdDrawdownSplitStrategy, string> = {
  optimised: "Optimised (lowest total tax)",
  even: "Even split",
  custom: "Custom split",
};

/**
 * SPEC.md §4 journey 6's "always show the tax difference against
 * alternatives" for a jointly-owned drawdown target — re-runs the whole
 * projection with the split strategy swapped, for this one comparison
 * year only, and compares the household's total tax either way. A
 * genuine extra computation (not just reading a different field), but
 * the engine's performance target (SPEC.md §9.7) makes this cheap enough
 * for an on-demand page view.
 */
function useHouseholdDrawdownComparison(scenario: Scenario | null, taxYear: string | undefined) {
  return useMemo(() => {
    if (!scenario || !taxYear) return null;
    const jointDrawdownSource = scenario.incomeSources.find(
      (s): s is IncomeSourceInstance<TargetDrawdownIncomeConfig> => s.type === "targetDrawdownIncome" && s.owner === "joint",
    );
    if (!jointDrawdownSource) return null;
    const currentStrategy = jointDrawdownSource.config.householdSplitStrategy ?? "optimised";

    const totalTaxWithStrategy = (strategy: HouseholdDrawdownSplitStrategy): Pence => {
      const scenarioWithStrategy: Scenario = {
        ...scenario,
        incomeSources: scenario.incomeSources.map((s) =>
          s.id === jointDrawdownSource.id ? { ...s, config: { ...jointDrawdownSource.config, householdSplitStrategy: strategy } } : s,
        ),
      };
      const row = computeProjection(scenarioWithStrategy).rows.find((r) => r.taxYear === taxYear);
      return row ? totalTaxForYear(row) : (0 as Pence);
    };

    const currentTax = totalTaxWithStrategy(currentStrategy);
    const evenTax = currentStrategy === "even" ? currentTax : totalTaxWithStrategy("even");
    return { currentStrategy, currentTax, evenTax, saving: subtractPence(evenTax, currentTax) };
  }, [scenario, taxYear]);
}

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

  const rows = result?.rows ?? [];
  const row = rows.find((r) => r.taxYear === selectedTaxYear) ?? rows[0];
  const drawdownComparison = useHouseholdDrawdownComparison(scenario, row?.taxYear);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack maw={720} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Tax breakdown</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" onClick={() => void navigate("/dashboard")}>
            Back to projection
          </Button>
          <ColorSchemeToggle />
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

      {row && row.survivorshipEvents.length > 0 && (
        <Alert color="orange" variant="light">
          {row.survivorshipEvents.map((event) => (
            <Text size="sm" key={event.deceasedPersonId}>
              A modelling assumption: from this year, the deceased partner&rsquo;s GIA/cash balances are assumed
              inherited by the survivor — actual treatment depends on the will/estate, and pension death-benefit
              rules aren&rsquo;t modelled at all (SPEC.md §5.7.5).
            </Text>
          ))}
        </Alert>
      )}

      {drawdownComparison && (
        <Section title="Household drawdown split (SPEC.md §5.7.4, §4 journey 6)">
          <KeyValue label={`Total tax this year — ${STRATEGY_LABELS[drawdownComparison.currentStrategy]}`} amount={drawdownComparison.currentTax} bold />
          {drawdownComparison.currentStrategy !== "even" && (
            <>
              <KeyValue label="Total tax this year — even split instead" amount={drawdownComparison.evenTax} />
              <Text size="sm" c={drawdownComparison.saving > 0 ? "teal.7" : "dimmed"}>
                {drawdownComparison.saving > 0
                  ? `The current split saves ${formatMoney(drawdownComparison.saving)} versus an even split, by routing more of the target through whichever of you has cheaper unused allowance.`
                  : "No tax difference between the two splits this year."}
              </Text>
            </>
          )}
        </Section>
      )}

      {row?.perPerson.map((person, index) => (
        <PersonBreakdown key={person.personId} person={person} {...(row.perPerson.length > 1 ? { label: index === 0 ? "You" : "Your partner" } : {})} />
      ))}
    </Stack>
  );
}

function PersonBreakdown({ person, label }: { readonly person: PersonYearResult; readonly label?: string }) {
  const totalTax = subtractPence(
    sumPence([
      person.incomeTax,
      person.nationalInsurance,
      person.annualAllowanceCharge,
      person.drawdownIncomeTax,
      person.drawdownCapitalGainsTax,
      person.savingsTax,
      person.dividendTax,
      person.propertySaleCapitalGainsTax,
    ]),
    person.mortgageInterestCredit,
  );

  return (
    <Stack gap="lg">
      {label && <Title order={3}>{label}</Title>}
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

      {(person.marriageAllowanceGiven > 0 || person.marriageAllowanceReceived > 0) && (
        <Section title="Marriage Allowance">
          {person.marriageAllowanceGiven > 0 && (
            <KeyValue
              label="Given to your spouse/civil partner"
              amount={person.marriageAllowanceGiven}
              description="Reduces your own Personal Allowance by this amount — eligible because your income didn't use it all anyway."
            />
          )}
          {person.marriageAllowanceReceived > 0 && (
            <KeyValue
              label="Received from your spouse/civil partner"
              amount={person.marriageAllowanceReceived}
              description="Increases your own Personal Allowance by this amount, visible in the Personal Allowance band above."
            />
          )}
        </Section>
      )}

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

      {(person.rentalProfitIncome > 0 || person.mortgageInterestCredit > 0) && (
        <Section title="Rental income">
          <KeyValue
            label="Net rental profit"
            amount={person.rentalProfitIncome}
            description="Gross rental income minus whichever of actual letting costs or the Property Income Allowance is larger — already included in the Income Tax bands above, taxed at your marginal rate alongside earned/pension income."
          />
          {person.mortgageInterestCredit > 0 && (
            <KeyValue
              label="Mortgage interest tax credit"
              amount={person.mortgageInterestCredit}
              description="Mortgage interest on a rental property isn't deducted from rental profit before tax — instead you get this flat-rate credit (interest × basic rate) against your overall tax bill, regardless of your own marginal rate."
            />
          )}
        </Section>
      )}

      {(person.propertySaleGain > 0 || person.propertySaleNetProceeds !== 0) && (
        <Section title="Property sale">
          <KeyValue label="Gain (sale price − purchase price − selling costs)" amount={person.propertySaleGain} />
          {person.propertySalePrivateResidenceReliefApplied ? (
            <KeyValue
              label="Capital Gains Tax"
              amount={person.propertySaleCapitalGainsTax}
              description="Fully exempt — Private Residence Relief, assuming this was your (or your household's) only/main home for the whole time you owned it."
            />
          ) : (
            <KeyValue
              label="Capital Gains Tax"
              amount={person.propertySaleCapitalGainsTax}
              description="At the residential property rate, after your CGT Annual Exempt Amount (shared with any other capital gains this year, e.g. a GIA withdrawal)."
            />
          )}
          <KeyValue label="Net proceeds (after selling costs, mortgage redemption, and CGT)" amount={person.propertySaleNetProceeds} bold />
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
          {person.otherExpenses > 0 && (
            <KeyValue label="Living expenses, mortgage payments, and one-off outflows" amount={person.otherExpenses} />
          )}
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
