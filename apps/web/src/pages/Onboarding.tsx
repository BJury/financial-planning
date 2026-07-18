import {
  convertNominalToReal,
  convertRealToNominal,
  pence,
  penceToPounds,
  personId,
  poundsToPence,
  registry,
  type CatalogFieldSchema,
  type Household,
  type IncomeDrainInstance,
  type IncomeSourceInstance,
  type IsaAccount,
  type PensionAccount,
  type Scenario,
} from "@fp/engine";
import { ActionIcon, Button, Card, Group, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router";
import { CatalogItemForm } from "../catalog-ui/CatalogItemForm.js";
import { CatalogPicker } from "../catalog-ui/CatalogPicker.js";
import { useScenarioStore } from "../state/store.js";

const PERSON_ID = personId("me");
const DEFAULT_INFLATION_RATE = 0.025;
const DEFAULT_TARGET_RETIREMENT_AGE = 67;

// A random, collision-proof id rather than a sequential counter — this
// page can be re-entered with an *existing* Scenario already loaded
// (see draftsFromScenario below), whose items already have ids; a
// counter restarting at 1 on every mount would eventually collide with
// one of those (SPEC.md §9.1's browser baseline already assumes
// crypto.randomUUID, so this needs no extra dependency).
function generateId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

interface PensionAccountDraft {
  readonly id: string;
  readonly currentBalance: number; // pounds — converted to Pence only when building the Scenario
  readonly annualGrowthRate: number; // real (SPEC.md §5.8) — see note on GrowthRateInput below
  readonly annualChargeRate: number;
  readonly employerAnnualContribution: number; // pounds
}

interface IsaAccountDraft {
  readonly id: string;
  readonly currentBalance: number;
  readonly annualGrowthRate: number; // real
}

/**
 * A sensible empty/zero default for every field in a schema — nothing is
 * pre-filled with a "real" value, so an added-but-untouched item simply
 * contributes nothing (SPEC.md §3.11: everything is optional, added when
 * needed, never forced upfront).
 */
function createDefaultConfig(fields: readonly CatalogFieldSchema<unknown>[]): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  for (const field of fields) {
    switch (field.input) {
      case "currency":
        config[field.key] = pence(0);
        break;
      case "percentage":
      case "growthRate":
        config[field.key] = 0;
        break;
      case "boolean":
        config[field.key] = false;
        break;
      case "text":
      case "date":
        config[field.key] = "";
        break;
      case "select":
        config[field.key] = field.options?.[0]?.value;
        break;
      case "age":
      default:
        config[field.key] = undefined;
        break;
    }
  }
  return config;
}

interface OnboardingDrafts {
  readonly dateOfBirth: string;
  readonly inflationRate: number;
  readonly pensionAccounts: readonly PensionAccountDraft[];
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly incomeSources: readonly IncomeSourceInstance[];
  readonly incomeDrains: readonly IncomeDrainInstance[];
}

/**
 * Derives this page's editable draft state from whatever Scenario is
 * currently in the store — the fix for this page previously always
 * starting blank, silently discarding an existing plan (including
 * settings like the inflation rate) the moment "Edit plan" was clicked.
 * Returns sensible empty defaults for a genuine first-time visit, where
 * there is no Scenario yet.
 */
function draftsFromScenario(scenario: Scenario | null): OnboardingDrafts {
  if (!scenario) {
    return {
      dateOfBirth: "",
      inflationRate: DEFAULT_INFLATION_RATE,
      pensionAccounts: [],
      isaAccounts: [],
      incomeSources: [],
      incomeDrains: [],
    };
  }

  const person = scenario.household.people[0];

  return {
    dateOfBirth: person?.dateOfBirth ?? "",
    inflationRate: scenario.inflationRate,
    pensionAccounts: scenario.accounts
      .filter((a): a is PensionAccount => a.kind === "pension")
      .map((a) => ({
        id: a.id,
        currentBalance: penceToPounds(a.currentBalance),
        annualGrowthRate: a.annualGrowthRate,
        annualChargeRate: a.annualChargeRate,
        employerAnnualContribution: penceToPounds(a.employerAnnualContribution),
      })),
    isaAccounts: scenario.accounts
      .filter((a): a is IsaAccount => a.kind === "isa")
      .map((a) => ({ id: a.id, currentBalance: penceToPounds(a.currentBalance), annualGrowthRate: a.annualGrowthRate })),
    incomeSources: scenario.incomeSources,
    incomeDrains: scenario.incomeDrains,
  };
}

/**
 * Phase 1's onboarding/plan editor (SPEC.md §4 journey 1): nothing is
 * mandatory except a date of birth. Accounts and every cash flow are
 * added one at a time from a catalog picker (SPEC.md §3.11, §9.4) and
 * can be removed just as freely — there is no fixed "fill in this form"
 * structure. Re-entering this page with an existing plan (§4 journey 1's
 * "returning visit... offers Edit plan") hydrates every field below from
 * it, rather than starting blank.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const setScenario = useScenarioStore((s) => s.setScenario);
  const existingScenario = useScenarioStore((s) => s.scenario);

  // Computed once, from whatever was in the store at mount time — by the
  // time this page can be reached, App's initial hydration (§9.2) has
  // already resolved, so `existingScenario` here is either a real
  // previously-saved plan or genuinely null for a first-time visit.
  const [initial] = useState(() => draftsFromScenario(existingScenario));

  const [dateOfBirth, setDateOfBirth] = useState(initial.dateOfBirth);
  const [inflationRate, setInflationRate] = useState(initial.inflationRate);
  const [pensionAccounts, setPensionAccounts] = useState<PensionAccountDraft[]>([...initial.pensionAccounts]);
  const [isaAccounts, setIsaAccounts] = useState<IsaAccountDraft[]>([...initial.isaAccounts]);
  const [incomeSources, setIncomeSources] = useState<IncomeSourceInstance[]>([...initial.incomeSources]);
  const [incomeDrains, setIncomeDrains] = useState<IncomeDrainInstance[]>([...initial.incomeDrains]);

  const addIncomeSource = (type: string) => {
    const definition = registry.getIncomeSource(type);
    const config = createDefaultConfig(definition.fields);
    // A drawdown target's start age defaults, in the UI, to the person's
    // target retirement age (SPEC.md §5.7.1) — Phase 1 hardcodes that age
    // (see handleSubmit below) since it isn't yet a separate user input.
    if ("startAge" in config && type === "targetDrawdownIncome") config.startAge = DEFAULT_TARGET_RETIREMENT_AGE;
    setIncomeSources((prev) => [...prev, { id: generateId("src"), type, owner: PERSON_ID, config }]);
  };

  const addIncomeDrain = (type: string) => {
    const definition = registry.getIncomeDrain(type);
    const config = createDefaultConfig(definition.fields);
    setIncomeDrains((prev) => [...prev, { id: generateId("drain"), type, owner: PERSON_ID, config }]);
  };

  const canSubmit = dateOfBirth.length > 0;

  const handleSubmit = () => {
    const household: Household = {
      people: [{ id: PERSON_ID, dateOfBirth, targetRetirementAge: DEFAULT_TARGET_RETIREMENT_AGE, projectionEndAge: 95 }],
      relationshipStatus: null,
      targetIncomeMode: "perPerson",
    };

    const pensionAccountEntities: PensionAccount[] = pensionAccounts.map((a) => ({
      kind: "pension",
      id: a.id,
      owner: PERSON_ID,
      pensionType: "workplaceDC",
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
      annualChargeRate: a.annualChargeRate,
      employerAnnualContribution: poundsToPence(a.employerAnnualContribution),
    }));

    const isaAccountEntities: IsaAccount[] = isaAccounts.map((a) => ({
      kind: "isa",
      id: a.id,
      owner: PERSON_ID,
      isaType: "stocksAndShares",
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
    }));

    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [...pensionAccountEntities, ...isaAccountEntities],
      incomeSources,
      incomeDrains,
      inflationRate,
      upratingPolicy: { kind: "inflationLinked" },
    };

    setScenario(scenario);
    void navigate("/dashboard");
  };

  return (
    <Stack maw={560} mx="auto" my="xl" gap="xl">
      <Title order={2}>Your plan</Title>

      <Stack gap="sm">
        <Title order={4}>About you</Title>
        <TextInput
          type="date"
          label="Date of birth"
          required
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.currentTarget.value)}
        />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Assumptions</Title>
        <NumberInput
          label="Inflation rate"
          description="Used to convert every growth rate you enter below from the nominal figure you'd naturally quote into today's-money terms (SPEC.md §3.10, §5.8) — you never need to do that conversion yourself."
          rightSection="%"
          decimalScale={2}
          value={inflationRate * 100}
          onChange={(v) => setInflationRate(typeof v === "number" ? v / 100 : 0)}
        />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Accounts</Title>
        <Text size="sm" c="dimmed">
          Add an account for each pension or ISA you hold — none are required, and you can add more than one of each.
        </Text>

        {pensionAccounts.map((account) => (
          <PensionAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            onChange={(updated) => setPensionAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setPensionAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}
        {isaAccounts.map((account) => (
          <IsaAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            onChange={(updated) => setIsaAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setIsaAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}

        <Group>
          <Button
            variant="light"
            onClick={() =>
              setPensionAccounts((prev) => [
                ...prev,
                {
                  id: generateId("pension"),
                  currentBalance: 0,
                  annualGrowthRate: 0,
                  annualChargeRate: 0.005,
                  employerAnnualContribution: 0,
                },
              ])
            }
          >
            + Add pension
          </Button>
          <Button
            variant="light"
            onClick={() => setIsaAccounts((prev) => [...prev, { id: generateId("isa"), currentBalance: 0, annualGrowthRate: 0 }])}
          >
            + Add ISA
          </Button>
        </Group>
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Income</Title>
        <Text size="sm" c="dimmed">
          Nothing here is required — add whichever sources of income actually apply to you.
        </Text>
        {incomeSources.map((source) => (
          <CatalogInstanceCard
            key={source.id}
            instance={source}
            kind="source"
            pensionAccounts={pensionAccounts}
            isaAccounts={isaAccounts}
            inflationRate={inflationRate}
            onChange={(updated) => setIncomeSources((prev) => prev.map((s) => (s.id === updated.id ? (updated as IncomeSourceInstance) : s)))}
            onRemove={() => setIncomeSources((prev) => prev.filter((s) => s.id !== source.id))}
          />
        ))}
        <CatalogPicker kind="source" onSelect={addIncomeSource} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Outgoings</Title>
        <Text size="sm" c="dimmed">
          Same here — add a drain (a pension or ISA contribution, for now) only if you have one.
        </Text>
        {incomeDrains.map((drain) => (
          <CatalogInstanceCard
            key={drain.id}
            instance={drain}
            kind="drain"
            pensionAccounts={pensionAccounts}
            isaAccounts={isaAccounts}
            inflationRate={inflationRate}
            onChange={(updated) => setIncomeDrains((prev) => prev.map((d) => (d.id === updated.id ? (updated as IncomeDrainInstance) : d)))}
            onRemove={() => setIncomeDrains((prev) => prev.filter((d) => d.id !== drain.id))}
          />
        ))}
        <CatalogPicker kind="drain" onSelect={addIncomeDrain} />
      </Stack>

      <Button onClick={handleSubmit} size="md" disabled={!canSubmit}>
        See my projection
      </Button>
    </Stack>
  );
}

/**
 * A growth-rate input shared by the two hand-written account cards below
 * (Accounts aren't catalog types, SPEC.md §3.11, so they don't go through
 * CatalogItemForm — but they need the identical nominal-in/real-stored
 * treatment as a catalog type's `"growthRate"` field, SPEC.md §5.8).
 */
function GrowthRateInput({
  label,
  realValue,
  inflationRate,
  onChange,
}: {
  readonly label: string;
  readonly realValue: number;
  readonly inflationRate: number;
  readonly onChange: (realValue: number) => void;
}) {
  return (
    <NumberInput
      label={label}
      description="Before inflation — adjusted for it automatically"
      rightSection="%"
      decimalScale={2}
      value={convertRealToNominal(realValue, inflationRate) * 100}
      onChange={(v) => onChange(typeof v === "number" ? convertNominalToReal(v / 100, inflationRate) : 0)}
    />
  );
}

function PensionAccountCard({
  account,
  inflationRate,
  onChange,
  onRemove,
}: {
  readonly account: PensionAccountDraft;
  readonly inflationRate: number;
  readonly onChange: (account: PensionAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Pension</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove pension account">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        <NumberInput
          label="Current pot value"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.currentBalance}
          onChange={(v) => onChange({ ...account, currentBalance: typeof v === "number" ? v : 0 })}
        />
        <GrowthRateInput
          label="Expected annual growth"
          realValue={account.annualGrowthRate}
          inflationRate={inflationRate}
          onChange={(v) => onChange({ ...account, annualGrowthRate: v })}
        />
        <NumberInput
          label="Annual charge"
          rightSection="%"
          value={account.annualChargeRate * 100}
          onChange={(v) => onChange({ ...account, annualChargeRate: typeof v === "number" ? v / 100 : 0 })}
        />
        <NumberInput
          label="Employer contribution (per year)"
          description="Paid directly by your employer, on top of anything you contribute yourself — never taxed as your income, but counts toward your Annual Allowance"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.employerAnnualContribution}
          onChange={(v) => onChange({ ...account, employerAnnualContribution: typeof v === "number" ? v : 0 })}
        />
      </Stack>
    </Card>
  );
}

function IsaAccountCard({
  account,
  inflationRate,
  onChange,
  onRemove,
}: {
  readonly account: IsaAccountDraft;
  readonly inflationRate: number;
  readonly onChange: (account: IsaAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>ISA</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove ISA account">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        <NumberInput
          label="Current balance"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.currentBalance}
          onChange={(v) => onChange({ ...account, currentBalance: typeof v === "number" ? v : 0 })}
        />
        <GrowthRateInput
          label="Expected annual growth"
          realValue={account.annualGrowthRate}
          inflationRate={inflationRate}
          onChange={(v) => onChange({ ...account, annualGrowthRate: v })}
        />
      </Stack>
    </Card>
  );
}

/**
 * Renders one added Income Source/Drain instance via the generic
 * CatalogItemForm (SPEC.md §3.11) — the one place a field needs
 * something the static schema can't provide (which account a
 * contribution funds) is resolved here, from the currently-added
 * accounts, rather than baked into the catalog type itself.
 */
function CatalogInstanceCard({
  instance,
  kind,
  pensionAccounts,
  isaAccounts,
  inflationRate,
  onChange,
  onRemove,
}: {
  readonly instance: IncomeSourceInstance | IncomeDrainInstance;
  readonly kind: "source" | "drain";
  readonly pensionAccounts: readonly PensionAccountDraft[];
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly inflationRate: number;
  readonly onChange: (instance: IncomeSourceInstance | IncomeDrainInstance) => void;
  readonly onRemove: () => void;
}) {
  const definition = kind === "source" ? registry.getIncomeSource(instance.type) : registry.getIncomeDrain(instance.type);

  const fields = definition.fields.map((field) => {
      if (field.key === "pensionAccountId") {
        return { ...field, options: pensionAccounts.map((a) => ({ value: a.id, label: `Pension (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "isaAccountId") {
        return { ...field, options: isaAccounts.map((a) => ({ value: a.id, label: `ISA (£${a.currentBalance.toLocaleString()})` })) };
      }
      return field;
    });

  const needsPensionAccount = fields.some((f) => f.key === "pensionAccountId") && pensionAccounts.length === 0;
  const needsIsaAccount = fields.some((f) => f.key === "isaAccountId") && isaAccounts.length === 0;

  // Generic scheduling (SPEC.md §3.11) — separate from the type's own
  // config, since not every income/outgoing is tied to a person's age
  // (e.g. a rental starting in 5 years and running for 10). An empty
  // input means "not set" and is omitted entirely, never stored as "".
  const setStartDate = (value: string) => {
    const { startDate: _existing, ...rest } = instance;
    onChange(value ? { ...rest, startDate: value } : rest);
  };
  const setEndDate = (value: string) => {
    const { endDate: _existing, ...rest } = instance;
    onChange(value ? { ...rest, endDate: value } : rest);
  };

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{definition.displayName}</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label={`Remove ${definition.displayName}`}>
          ✕
        </ActionIcon>
      </Group>
      {needsPensionAccount && (
        <Text size="sm" c="orange.7" mb="xs">
          Add a pension account above first.
        </Text>
      )}
      {needsIsaAccount && (
        <Text size="sm" c="orange.7" mb="xs">
          Add an ISA account above first.
        </Text>
      )}
      <CatalogItemForm
        fields={fields}
        value={instance.config as Record<string, unknown>}
        inflationRate={inflationRate}
        onChange={(config) => onChange({ ...instance, config })}
      />
      <Group grow mt="sm">
        <TextInput
          type="date"
          label="Starts on"
          description="Leave blank to start immediately"
          value={instance.startDate ?? ""}
          onChange={(e) => setStartDate(e.currentTarget.value)}
        />
        <TextInput
          type="date"
          label="Ends on"
          description="Leave blank for no end date"
          value={instance.endDate ?? ""}
          onChange={(e) => setEndDate(e.currentTarget.value)}
        />
      </Group>
    </Card>
  );
}
