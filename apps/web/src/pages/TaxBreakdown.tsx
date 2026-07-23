import {
  addPence,
  ageAtYear,
  getLatestConfirmedRuleSet,
  multiplyPenceByRate,
  prepareRuleSetForScenario,
  subtractPence,
  sumPence,
  totalTaxForYear,
  type HouseholdDrawdownSplitStrategy,
  type IncomeSourceInstance,
  type Pence,
  type PersonYearResult,
  type PreparedYearRules,
  type Scenario,
  type TargetDrawdownIncomeConfig,
  type YearLedgerRow,
} from "@fp/engine";
import { Alert, Button, Card, Group, Select, Stack, Table, Text, Title } from "@mantine/core";
import { useMemo, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router";
import { AboutDialog } from "../components/AboutDialog.js";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { InfoTip } from "../components/InfoTip.js";
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
 *
 * There can be more than one joint `targetDrawdownIncome` instance now
 * (step phases, e.g. a higher target before State Pension age and a
 * lower one after) — picks whichever one is actually active in the
 * selected year, gated on the first household member's age, the same
 * documented v1 convention the type's own `isActive` already uses
 * (SPEC.md §5.7.4), rather than always grabbing the first instance found
 * regardless of whether it's the one actually in effect that year.
 */
function useHouseholdDrawdownComparison(scenario: Scenario | null, row: YearLedgerRow | undefined) {
  return useMemo(() => {
    if (!scenario || !row) return null;
    const firstPerson = scenario.household.people[0];
    if (!firstPerson) return null;
    const age = ageAtYear(firstPerson.dateOfBirth, row.calendarYear);
    const jointDrawdownSource = scenario.incomeSources.find((s): s is IncomeSourceInstance<TargetDrawdownIncomeConfig> => {
      if (s.type !== "targetDrawdownIncome" || s.owner !== "joint") return false;
      const config = s.config as TargetDrawdownIncomeConfig;
      return age >= config.startAge && (config.endAge === undefined || age < config.endAge);
    });
    if (!jointDrawdownSource) return null;
    const currentStrategy = jointDrawdownSource.config.householdSplitStrategy ?? "optimised";

    const totalTaxWithStrategy = (strategy: HouseholdDrawdownSplitStrategy): Pence => {
      const scenarioWithStrategy: Scenario = {
        ...scenario,
        incomeSources: scenario.incomeSources.map((s) =>
          s.id === jointDrawdownSource.id ? { ...s, config: { ...jointDrawdownSource.config, householdSplitStrategy: strategy } } : s,
        ),
      };
      const recomputedRow = computeProjection(scenarioWithStrategy).rows.find((r) => r.taxYear === row.taxYear);
      return recomputedRow ? totalTaxForYear(recomputedRow) : (0 as Pence);
    };

    const currentTax = totalTaxWithStrategy(currentStrategy);
    const evenTax = currentStrategy === "even" ? currentTax : totalTaxWithStrategy("even");
    return { currentStrategy, currentTax, evenTax, saving: subtractPence(evenTax, currentTax) };
  }, [scenario, row]);
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
  const drawdownComparison = useHouseholdDrawdownComparison(scenario, row);

  // The exact rules the engine itself used for the selected year (SPEC.md
  // §5.8) — real-terms uprated, not the raw current-year figures, so this
  // matches what actually drove the numbers below rather than a separate,
  // possibly-stale reference. Re-derived independently from `scenario`
  // rather than threaded through `YearLedgerRow` (which would mean
  // carrying this whole object on every one of the projection's ~30-50
  // rows just for this one reference display).
  const prepared = useMemo(() => {
    if (!scenario || !row) return null;
    const confirmedRuleSet = getLatestConfirmedRuleSet();
    const confirmedCalendarYear = Number.parseInt(confirmedRuleSet.taxYear.split("-")[0] ?? "0", 10);
    return prepareRuleSetForScenario(confirmedRuleSet, scenario.upratingPolicy, scenario.inflationRate, row.calendarYear - confirmedCalendarYear);
  }, [scenario, row]);

  if (!scenario) {
    return <Navigate to="/" replace />;
  }

  return (
    <Stack maw={720} mx="auto" my="xl" gap="xl">
      <Group justify="space-between">
        <Title order={2}>Tax breakdown</Title>
        <Group gap="xs">
          <PlanFileControls />
          <Button variant="subtle" size="xs" onClick={() => void navigate("/")}>
            Back to projection
          </Button>
          <AboutDialog />
          <ColorSchemeToggle />
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Exactly how this year&rsquo;s tax was calculated — every total here matches the year-by-year table.
      </Alert>

      <Select
        label="Tax year"
        data={rows.map((r) => r.taxYear)}
        value={row?.taxYear ?? null}
        onChange={setSelectedTaxYear}
        allowDeselect={false}
      />

      {prepared && <TaxRulesReference prepared={prepared} />}

      {row && row.survivorshipEvents.length > 0 && (
        <Alert color="orange" variant="light">
          {row.survivorshipEvents.map((event) => (
            <Text size="sm" key={event.deceasedPersonId}>
              Modelling assumption: the deceased partner&rsquo;s GIA/cash balances are assumed inherited by the
              survivor — actual treatment depends on the will/estate. Pension death benefits aren&rsquo;t modelled.
            </Text>
          ))}
        </Alert>
      )}

      {drawdownComparison && (
        <Section title="Household drawdown split">
          <KeyValue label={`Total tax this year — ${STRATEGY_LABELS[drawdownComparison.currentStrategy]}`} amount={drawdownComparison.currentTax} bold />
          {drawdownComparison.currentStrategy !== "even" && (
            <>
              <KeyValue label="Total tax this year — even split instead" amount={drawdownComparison.evenTax} />
              <Text size="sm" c={drawdownComparison.saving > 0 ? "teal.7" : "dimmed"}>
                {drawdownComparison.saving > 0
                  ? `Saves ${formatMoney(drawdownComparison.saving)} versus an even split.`
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
      person.shortfallCapitalGainsTax,
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

      {(person.grossPensionContribution > 0 || person.pensionInputAmount > 0 || person.annualAllowanceCharge > 0 || person.mpaaActive) && (
        <Section title="Pension relief and Annual Allowance">
          {person.grossPensionContribution > 0 && (
            <KeyValue
              label="Relief-at-source contribution, grossed up"
              amount={person.grossPensionContribution}
              info="This extends your basic/higher rate band ceilings, so more income above may show as taxed at a lower rate than expected."
            />
          )}
          <KeyValue label="Total pension input this year (the Annual Allowance test figure)" amount={person.pensionInputAmount} />
          {person.mpaaActive && (
            <Text size="sm" c="orange.7">
              ⚠ Money Purchase Annual Allowance active — future pension contributions are capped at a lower allowance, with no carry-forward.
            </Text>
          )}
          {person.annualAllowanceCharge > 0 && (
            <KeyValue
              label="Annual Allowance charge"
              amount={person.annualAllowanceCharge}
              description={
                person.mpaaActive
                  ? "Contributions exceeded the (MPAA-capped) Annual Allowance — the excess is charged back at your marginal rate."
                  : "Contributions exceeded the available Annual Allowance (including any carried-forward headroom) — the excess is charged back at your marginal rate."
              }
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

      {person.statePensionIncome > 0 && (
        <Section title="State Pension">
          <KeyValue
            label="State Pension income"
            amount={person.statePensionIncome}
            info="Paid gross, taxed at your marginal rate alongside earned/pension income — never subject to National Insurance."
          />
        </Section>
      )}

      {(person.rentalProfitIncome > 0 || person.mortgageInterestCredit > 0) && (
        <Section title="Rental income">
          <KeyValue
            label="Net rental profit"
            amount={person.rentalProfitIncome}
            info="Gross rental income minus letting costs or the Property Income Allowance, whichever is larger — taxed at your marginal rate."
          />
          {person.mortgageInterestCredit > 0 && (
            <KeyValue
              label="Mortgage interest tax credit"
              amount={person.mortgageInterestCredit}
              info="Mortgage interest isn't deducted from rental profit before tax — instead you get this flat-rate credit against your overall tax bill."
            />
          )}
        </Section>
      )}

      {person.propertySaleOccurred && (
        <Section title="Property sale">
          <KeyValue label="Gain (sale price − purchase price − selling costs)" amount={person.propertySaleGain} />
          {person.propertySalePrivateResidenceReliefApplied ? (
            <KeyValue
              label="Capital Gains Tax"
              amount={person.propertySaleCapitalGainsTax}
              info="Fully exempt under Private Residence Relief — assumes this was your only/main home for the whole time you owned it."
            />
          ) : (
            <KeyValue
              label="Capital Gains Tax"
              amount={person.propertySaleCapitalGainsTax}
              info="At the residential property rate, after your CGT Annual Exempt Amount (shared with any other capital gains this year, e.g. a GIA withdrawal)."
            />
          )}
          <KeyValue
            label="Net proceeds not sent to a chosen account"
            amount={person.propertySaleNetProceeds}
            bold
            info="After selling costs, mortgage redemption, and CGT. If this property's sale was set to pay into a specific ISA/GIA/cash account, whatever fit there is credited directly instead and won't appear here — this is only the leftover, counted as ordinary income."
          />
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

      {(person.taxFreeIncome > 0 ||
        person.otherExpenses > 0 ||
        person.accountContributions > 0 ||
        person.unallocatedSurplus > 0 ||
        person.shortfallFundedFromSavings > 0 ||
        person.livingExpensesShortfall) && (
        <Section title="Other cash flows">
          {person.taxFreeIncome > 0 && <KeyValue label="Tax-free income (e.g. a one-off inheritance)" amount={person.taxFreeIncome} />}
          {person.otherExpenses > 0 && (
            <KeyValue label="Continuous outflows, mortgage payments, and one-off outflows" amount={person.otherExpenses} />
          )}
          {person.accountContributions > 0 && (
            <KeyValue
              label="Pension/ISA/GIA/cash contributions"
              amount={person.accountContributions}
              info="Credited to the account shown, but not subtracted from Net income below — a contribution is treated as money arriving from outside this plan's own tracked income, the same assumption an employer pension contribution already makes. A relief-at-source pension's basic-rate top-up isn't counted here either, since that's a further amount on top from the government, not from any pocket at all."
            />
          )}
          {person.unallocatedSurplus > 0 && (
            <KeyValue
              label="Income Over Target"
              amount={person.unallocatedSurplus}
              info="Income beyond what a drawdown target already treats as spent — not automatically invested anywhere. Add a contribution if you'd like to capture it. Not reduced by any contribution already added, since a contribution is separate, untracked-source money rather than a claim on this figure."
            />
          )}
          {person.shortfallFundedFromSavings > 0 && (
            <KeyValue
              label="Shortfall funded from cash/ISA/GIA savings"
              amount={person.shortfallFundedFromSavings}
              info="Outgoings exceeded income, so this was drawn from your own liquid savings (cash first, then ISA, then GIA) — never a pension."
            />
          )}
          {person.shortfallCapitalGainsTax > 0 && (
            <KeyValue label="CGT on the GIA portion of that shortfall" amount={person.shortfallCapitalGainsTax} />
          )}
          {person.livingExpensesShortfall && (
            <Text size="sm" c="orange.7">
              ⚠ Outgoings exceed income and available cash/ISA/GIA savings this year — the shortfall isn&rsquo;t fully covered.
            </Text>
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

/** A `PreparedYearRules.incomeTaxBands` entry — not imported by name (that type isn't part of the engine's public API surface), just derived structurally from the one field that already exposes its shape. */
type IncomeTaxBandRule = PreparedYearRules["incomeTaxBands"][number];

/** The rate that applies to the next pound of income at exactly this total — used to find which band the Personal Allowance taper range itself falls in, without hardcoding "the higher rate" (SPEC.md's own bands could in principle be restructured in a future tax year). */
function marginalRateAt(bands: readonly IncomeTaxBandRule[], totalIncome: Pence): number {
  for (const band of bands) {
    if (band.upTo === null || totalIncome <= band.upTo) return band.rate;
  }
  return bands[bands.length - 1]?.rate ?? 0;
}

/**
 * SPEC.md §4 journey 5's transparency mission, one level up from a single
 * year's calculated result: the actual rules that produced it. Shown in
 * real terms (today's money) rather than the raw published 2026/27
 * numbers — no year in the heading, deliberately: every scenario built
 * through this app's own UI always uses the `inflationLinked` uprating
 * policy (`Onboarding.tsx` hardcodes it, no control exists to change it),
 * under which a real-terms threshold is defined to stay unchanged from
 * one projected year to the next (`uprateThreshold.ts`) — so these
 * figures are genuinely identical for every year in this plan, and
 * labelling them with the currently-selected year would wrongly imply
 * they'd be different for another one.
 */
function TaxRulesReference({ prepared }: { readonly prepared: PreparedYearRules }) {
  // Where the Personal Allowance taper reaches £0 — £1 of allowance is
  // lost per £2 of income above the threshold (`personalAllowanceTaperRate`
  // of 0.5 already encodes that ratio), so the full allowance disappears
  // after `personalAllowance / taperRate` of extra income above it.
  const taperZeroPoint = addPence(
    prepared.personalAllowanceTaperThreshold,
    multiplyPenceByRate(prepared.personalAllowance, 1 / prepared.personalAllowanceTaperRate),
  );
  const effectiveTaperRate = marginalRateAt(prepared.incomeTaxBands, prepared.personalAllowanceTaperThreshold) * (1 + prepared.personalAllowanceTaperRate);

  return (
    <Section title="Tax rates & bands">
      <Text size="sm" c="dimmed">
        The rules every year&rsquo;s figures below are actually calculated with, in today&rsquo;s money — kept flat
        in real terms for the whole plan (SPEC.md §5.8), the same as every other assumption here, rather than fixed
        to 2026/27&rsquo;s published cash amounts.
      </Text>
      <Table>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Band</Table.Th>
            <Table.Th>Rate</Table.Th>
            <Table.Th>Up to</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <Table.Tr>
            <Table.Td>Personal Allowance</Table.Td>
            <Table.Td>{formatPercent(0)}</Table.Td>
            <Table.Td>{formatMoney(prepared.personalAllowance)}</Table.Td>
          </Table.Tr>
          {prepared.incomeTaxBands.map((band) => (
            <Table.Tr key={band.name}>
              <Table.Td>{BAND_LABELS[band.name] ?? band.name}</Table.Td>
              <Table.Td>{formatPercent(band.rate)}</Table.Td>
              <Table.Td>{band.upTo === null ? "No limit" : formatMoney(band.upTo)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
      <Text size="sm">
        <strong>Personal Allowance tapering:</strong> above {formatMoney(prepared.personalAllowanceTaperThreshold)} of
        adjusted net income, the Personal Allowance shown above shrinks by £1 for every £2 earned over that
        threshold — not the band rates themselves changing, but the tax-free amount disappearing, which pulls more
        income into tax. It reaches £0 once income hits {formatMoney(taperZeroPoint)}. Combined with the{" "}
        {formatPercent(marginalRateAt(prepared.incomeTaxBands, prepared.personalAllowanceTaperThreshold))} rate
        already applying in that range, this creates an effective marginal rate of about{" "}
        {formatPercent(effectiveTaperRate)} between those two figures — sometimes called the &ldquo;60% tax
        trap.&rdquo; A pension contribution (relief-at-source) reduces the adjusted net income this taper is measured
        against, which is why increasing one can pull someone back under the threshold and restore some of their
        allowance.
      </Text>
    </Section>
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
  info,
  bold,
}: {
  readonly label: string;
  readonly amount: Pence;
  readonly description?: string;
  /** Extra detail available on click via an `InfoTip`, rather than always-visible `description` text — for the "why", not the headline fact. */
  readonly info?: ReactNode;
  readonly bold?: boolean;
}) {
  return (
    <div>
      <Group justify="space-between">
        <Group gap={4}>
          <Text size="sm" fw={bold ? 700 : 400}>
            {label}
          </Text>
          {info && <InfoTip>{info}</InfoTip>}
        </Group>
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
