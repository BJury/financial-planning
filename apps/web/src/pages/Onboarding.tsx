import {
  convertNominalToReal,
  convertRealToNominal,
  DEFAULT_PROJECTION_YEARS,
  DEFAULT_STATE_PENSION_AGE,
  deriveAnnualRepaymentMortgagePayment,
  getLatestConfirmedRuleSet,
  pence,
  penceToPounds,
  personId,
  poundsToPence,
  registry,
  type CashAccount,
  type CatalogFieldSchema,
  type GiaAccount,
  type Household,
  type IncomeDrainInstance,
  type IncomeSourceInstance,
  type IsaAccount,
  type Owner,
  type PensionAccount,
  type PersonId,
  type Property,
  type Scenario,
} from "@fp/engine";
import { ActionIcon, AppShell, Burger, Button, Card, Group, NumberInput, ScrollArea, Select, Stack, Switch, Text, TextInput, Title } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { useEffect, useMemo, useState } from "react";
import { CatalogItemForm } from "../catalog-ui/CatalogItemForm.js";
import { CatalogPicker } from "../catalog-ui/CatalogPicker.js";
import { AgeOrDateInput, isoDateFromAge } from "../components/AgeOrDateInput.js";
import { ColorSchemeToggle } from "../components/ColorSchemeToggle.js";
import { InfoTip } from "../components/InfoTip.js";
import { PlanFileControls } from "../components/PlanFileControls.js";
import { ProjectionResults } from "../components/ProjectionResults.js";
import { useScenarioStore } from "../state/store.js";

const PERSON_ID = personId("me");
const PERSON_B_ID = personId("partner");
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
  /** Pensions can never be jointly held (SPEC.md §3.4) — always a specific person. */
  readonly owner: PersonId;
  readonly currentBalance: number; // pounds — converted to Pence only when building the Scenario
  readonly annualGrowthRate: number; // real (SPEC.md §5.8) — see note on GrowthRateInput below
  readonly annualChargeRate: number;
  readonly employerAnnualContribution: number; // pounds
}

interface IsaAccountDraft {
  readonly id: string;
  /** ISAs can never be jointly held (SPEC.md §3.5) — always a specific person. */
  readonly owner: PersonId;
  readonly currentBalance: number;
  readonly annualGrowthRate: number; // real
}

interface GiaAccountDraft {
  readonly id: string;
  readonly owner: Owner;
  readonly currentBalance: number;
  readonly costBasis: number; // pounds — how much was originally paid in, for future CGT purposes
  readonly annualGrowthRate: number; // real, capital appreciation only
  readonly annualDividendYield: number; // plain %, not nominal/real — a yield on the current (already-real) balance
}

interface CashAccountDraft {
  readonly id: string;
  readonly owner: Owner;
  readonly currentBalance: number;
  readonly annualGrowthRate: number; // real — this *is* the interest rate
}

interface PropertyAccountDraft {
  readonly id: string;
  readonly owner: Owner;
  readonly propertyType: "mainResidence" | "rental";
  readonly currentBalance: number; // pounds — current market value
  readonly annualGrowthRate: number; // real — house price growth
  readonly purchasePrice: number; // pounds
  readonly purchaseDate: string; // ISO date
  // Rental details — only used (and only submitted) when propertyType === "rental".
  readonly grossAnnualRentalIncome: number;
  readonly lettingCosts: number;
  readonly rentalGrowthRate: number; // real
  // Mortgage — optional.
  readonly hasMortgage: boolean;
  readonly mortgageInitialBalance: number;
  /** Genuinely nominal (SPEC.md §5.8) — never converted to real, unlike every other rate on this page. */
  readonly mortgageNominalInterestRate: number;
  readonly mortgageRepaymentType: "repayment" | "interestOnly";
  readonly mortgageTermYears: number;
  readonly mortgageAnnualPayment: number; // pounds, nominal
  // Planned sale — optional.
  readonly hasPlannedSale: boolean;
  readonly saleDate: string;
  readonly expectedSalePrice: number; // pounds — 0 means "not set" (grow current value to the sale date instead)
  readonly sellingCosts: number;
  /** An ISA/GIA/cash account id to credit the net sale proceeds into directly — unset means "just ordinary net income", today's default. */
  readonly destinationAccountId: string | undefined;
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
        // An *optional* currency field (e.g. the drawdown target's
        // taxable/non-taxable preference) must start genuinely unset, not
        // £0 — the two mean completely different things to the engine
        // (£0 is itself a deliberate, meaningful choice: "draw nothing
        // from this side"), unlike a required field, where £0 really is
        // just "nothing entered yet".
        config[field.key] = field.required ? pence(0) : undefined;
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

/**
 * The drawdown income target is the single most important input in the
 * whole plan (SPEC.md §5.7.1) — how much someone actually wants to live
 * on, which the engine works backwards from to decide the tax-efficient
 * pension/ISA/GIA/cash withdrawal mix. It's seeded here, always, rather
 * than left for the user to discover in the generic "+ Add income
 * source" picker — still exactly the same `targetDrawdownIncome` catalog
 * type under the hood (SPEC.md §9.4), just always present with a £0
 * default (a no-op until filled in) instead of opt-in.
 */
function createDefaultDrawdownTarget(): IncomeSourceInstance {
  const definition = registry.getIncomeSource("targetDrawdownIncome");
  const config = createDefaultConfig(definition.fields);
  config.startAge = DEFAULT_TARGET_RETIREMENT_AGE;
  return { id: generateId("drawdown-target"), type: "targetDrawdownIncome", owner: PERSON_ID, config };
}

interface OnboardingDrafts {
  readonly dateOfBirth: string;
  readonly statePensionAge: number;
  readonly inflationRate: number;
  readonly projectionYears: number;
  /** Whether the household has a second person (SPEC.md §3.1) — everything below is only meaningful when this is true. */
  readonly hasSecondPerson: boolean;
  readonly personBDateOfBirth: string;
  readonly personBStatePensionAge: number;
  readonly relationshipStatus: Household["relationshipStatus"];
  readonly marriageAllowanceElection: PersonId | undefined;
  readonly pensionAccounts: readonly PensionAccountDraft[];
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly giaAccounts: readonly GiaAccountDraft[];
  readonly cashAccounts: readonly CashAccountDraft[];
  readonly properties: readonly PropertyAccountDraft[];
  /** Always exactly one — see `createDefaultDrawdownTarget`. */
  readonly drawdownTarget: IncomeSourceInstance;
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
      statePensionAge: DEFAULT_STATE_PENSION_AGE,
      inflationRate: DEFAULT_INFLATION_RATE,
      projectionYears: DEFAULT_PROJECTION_YEARS,
      hasSecondPerson: false,
      personBDateOfBirth: "",
      personBStatePensionAge: DEFAULT_STATE_PENSION_AGE,
      relationshipStatus: null,
      marriageAllowanceElection: undefined,
      pensionAccounts: [],
      isaAccounts: [],
      giaAccounts: [],
      cashAccounts: [],
      properties: [],
      drawdownTarget: createDefaultDrawdownTarget(),
      incomeSources: [],
      incomeDrains: [],
    };
  }

  const [personA, personB] = scenario.household.people;
  // If a loaded plan somehow has more than one (e.g. hand-edited, or from
  // before this became a single permanent input), only the first is kept
  // as "the" managed target — a deliberate v1 simplification rather than
  // building UI for multiple targets, matching this section's own "always
  // exactly one" design.
  const existingDrawdownTarget = scenario.incomeSources.find((s) => s.type === "targetDrawdownIncome");

  return {
    dateOfBirth: personA?.dateOfBirth ?? "",
    statePensionAge: personA?.statePensionAge ?? DEFAULT_STATE_PENSION_AGE,
    inflationRate: scenario.inflationRate,
    projectionYears: scenario.projectionYears ?? DEFAULT_PROJECTION_YEARS,
    hasSecondPerson: personB !== undefined,
    personBDateOfBirth: personB?.dateOfBirth ?? "",
    personBStatePensionAge: personB?.statePensionAge ?? DEFAULT_STATE_PENSION_AGE,
    relationshipStatus: scenario.household.relationshipStatus,
    marriageAllowanceElection: scenario.household.marriageAllowanceElection,
    pensionAccounts: scenario.accounts
      .filter((a): a is PensionAccount => a.kind === "pension")
      .map((a) => ({
        id: a.id,
        owner: a.owner,
        currentBalance: penceToPounds(a.currentBalance),
        annualGrowthRate: a.annualGrowthRate,
        annualChargeRate: a.annualChargeRate,
        employerAnnualContribution: penceToPounds(a.employerAnnualContribution),
      })),
    isaAccounts: scenario.accounts
      .filter((a): a is IsaAccount => a.kind === "isa")
      .map((a) => ({ id: a.id, owner: a.owner, currentBalance: penceToPounds(a.currentBalance), annualGrowthRate: a.annualGrowthRate })),
    giaAccounts: scenario.accounts
      .filter((a): a is GiaAccount => a.kind === "gia")
      .map((a) => ({
        id: a.id,
        owner: a.owner,
        currentBalance: penceToPounds(a.currentBalance),
        costBasis: penceToPounds(a.costBasis),
        annualGrowthRate: a.annualGrowthRate,
        annualDividendYield: a.annualDividendYield,
      })),
    cashAccounts: scenario.accounts
      .filter((a): a is CashAccount => a.kind === "cash")
      .map((a) => ({ id: a.id, owner: a.owner, currentBalance: penceToPounds(a.currentBalance), annualGrowthRate: a.annualGrowthRate })),
    properties: scenario.accounts
      .filter((a): a is Property => a.kind === "property")
      .map((a) => ({
        id: a.id,
        owner: a.owner,
        propertyType: a.propertyType,
        currentBalance: penceToPounds(a.currentBalance),
        annualGrowthRate: a.annualGrowthRate,
        purchasePrice: penceToPounds(a.purchasePrice),
        purchaseDate: a.purchaseDate,
        grossAnnualRentalIncome: a.rentalDetails ? penceToPounds(a.rentalDetails.grossAnnualRentalIncome) : 0,
        lettingCosts: a.rentalDetails ? penceToPounds(a.rentalDetails.lettingCosts) : 0,
        rentalGrowthRate: a.rentalDetails?.annualGrowthRate ?? 0,
        hasMortgage: a.mortgage !== undefined,
        mortgageInitialBalance: a.mortgage ? penceToPounds(a.mortgage.initialBalance) : 0,
        mortgageNominalInterestRate: a.mortgage?.nominalInterestRate ?? 0,
        mortgageRepaymentType: a.mortgage?.repaymentType ?? "repayment",
        mortgageTermYears: a.mortgage?.termYears ?? 25,
        mortgageAnnualPayment: a.mortgage ? penceToPounds(a.mortgage.annualPayment) : 0,
        hasPlannedSale: a.plannedSale !== undefined,
        saleDate: a.plannedSale?.saleDate ?? "",
        expectedSalePrice: a.plannedSale?.expectedSalePrice ? penceToPounds(a.plannedSale.expectedSalePrice) : 0,
        sellingCosts: a.plannedSale ? penceToPounds(a.plannedSale.sellingCosts) : 0,
        destinationAccountId: a.plannedSale?.destinationAccountId,
      })),
    drawdownTarget: existingDrawdownTarget ?? createDefaultDrawdownTarget(),
    incomeSources: scenario.incomeSources.filter((s) => s.type !== "targetDrawdownIncome"),
    incomeDrains: scenario.incomeDrains,
  };
}

/**
 * The plan editor (SPEC.md §4 journey 1) and results pane, side by
 * side: nothing is mandatory except a date of birth. Accounts and every
 * cash flow are added one at a time from a catalog picker (SPEC.md
 * §3.11, §9.4) and can be removed just as freely — there is no fixed
 * "fill in this form" structure, and no separate submit step — every
 * edit here recomputes the projection shown in the main area
 * immediately (`liveScenario` below). Re-entering this page with an
 * existing plan hydrates every field below from it, rather than
 * starting blank.
 */
export function Onboarding() {
  const setScenario = useScenarioStore((s) => s.setScenario);
  const existingScenario = useScenarioStore((s) => s.scenario);
  const [navOpened, { toggle: toggleNav }] = useDisclosure();

  // Computed once, from whatever was in the store at mount time — by the
  // time this page can be reached, App's initial hydration (§9.2) has
  // already resolved, so `existingScenario` here is either a real
  // previously-saved plan or genuinely null for a first-time visit.
  const [initial] = useState(() => draftsFromScenario(existingScenario));

  const [dateOfBirth, setDateOfBirth] = useState(initial.dateOfBirth);
  const [statePensionAge, setStatePensionAge] = useState(initial.statePensionAge);
  const [inflationRate, setInflationRate] = useState(initial.inflationRate);
  const [projectionYears, setProjectionYears] = useState(initial.projectionYears);
  const [hasSecondPerson, setHasSecondPerson] = useState(initial.hasSecondPerson);
  const [personBDateOfBirth, setPersonBDateOfBirth] = useState(initial.personBDateOfBirth);
  const [personBStatePensionAge, setPersonBStatePensionAge] = useState(initial.personBStatePensionAge);
  const [relationshipStatus, setRelationshipStatus] = useState<Household["relationshipStatus"]>(initial.relationshipStatus);
  const [marriageAllowanceElection, setMarriageAllowanceElection] = useState<PersonId | undefined>(initial.marriageAllowanceElection);
  const [pensionAccounts, setPensionAccounts] = useState<PensionAccountDraft[]>([...initial.pensionAccounts]);
  const [isaAccounts, setIsaAccounts] = useState<IsaAccountDraft[]>([...initial.isaAccounts]);
  const [giaAccounts, setGiaAccounts] = useState<GiaAccountDraft[]>([...initial.giaAccounts]);
  const [cashAccounts, setCashAccounts] = useState<CashAccountDraft[]>([...initial.cashAccounts]);
  const [properties, setProperties] = useState<PropertyAccountDraft[]>([...initial.properties]);
  const [drawdownTarget, setDrawdownTarget] = useState<IncomeSourceInstance>(initial.drawdownTarget);
  const [incomeSources, setIncomeSources] = useState<IncomeSourceInstance[]>([...initial.incomeSources]);
  const [incomeDrains, setIncomeDrains] = useState<IncomeDrainInstance[]>([...initial.incomeDrains]);

  const addIncomeSource = (type: string) => {
    const definition = registry.getIncomeSource(type);
    const config = createDefaultConfig(definition.fields);
    // The full new State Pension amount (SPEC.md §3.3, §6.1) — a starting
    // point for anyone who doesn't yet have their own gov.uk forecast to
    // hand, not a substitute for it (most people qualify for less than
    // the full amount). Still just the UI's own default value, not the
    // "estimate from qualifying years" formula SPEC.md §3.3 separately
    // describes — that formula remains a documented, deferred v1 gap.
    if ("annualForecastAmount" in config && type === "statePension") {
      const { fullWeeklyAmount } = getLatestConfirmedRuleSet().statePension;
      config.annualForecastAmount = poundsToPence(fullWeeklyAmount * 52);
    }
    // Defaults State Pension's own "Starts on" scheduling field to this
    // person's own State Pension age (itself defaulting to 67) — shown in
    // Age mode by `CatalogInstanceCard`'s `defaultMode` prop, so it reads
    // as "67" rather than a birthday date. Technically redundant with the
    // catalog type's own age-gating (`Person.statePensionAge`, which
    // already stops it before that age regardless), but makes the default
    // visible directly on the card instead of only implied elsewhere on
    // the page. No-op if no date of birth is set yet.
    const startDate = type === "statePension" && dateOfBirth ? isoDateFromAge(dateOfBirth, statePensionAge) : undefined;
    setIncomeSources((prev) => [...prev, { id: generateId("src"), type, owner: PERSON_ID, config, ...(startDate ? { startDate } : {}) }]);
  };

  const addIncomeDrain = (type: string) => {
    const definition = registry.getIncomeDrain(type);
    const config = createDefaultConfig(definition.fields);
    setIncomeDrains((prev) => [...prev, { id: generateId("drain"), type, owner: PERSON_ID, config }]);
  };

  const canSubmit = dateOfBirth.length > 0 && (!hasSecondPerson || personBDateOfBirth.length > 0);

  const buildScenario = (): Scenario => {
    const household: Household = {
      people: [
        { id: PERSON_ID, dateOfBirth, targetRetirementAge: DEFAULT_TARGET_RETIREMENT_AGE, projectionEndAge: 95, statePensionAge },
        ...(hasSecondPerson
          ? [
              {
                id: PERSON_B_ID,
                dateOfBirth: personBDateOfBirth,
                targetRetirementAge: DEFAULT_TARGET_RETIREMENT_AGE,
                projectionEndAge: 95,
                statePensionAge: personBStatePensionAge,
              },
            ]
          : []),
      ],
      relationshipStatus: hasSecondPerson ? relationshipStatus : null,
      targetIncomeMode: "perPerson",
      ...(hasSecondPerson && relationshipStatus === "marriedOrCivilPartnership" && marriageAllowanceElection
        ? { marriageAllowanceElection }
        : {}),
    };

    const pensionAccountEntities: PensionAccount[] = pensionAccounts.map((a) => ({
      kind: "pension",
      id: a.id,
      owner: a.owner,
      // Only SIPPs are modelled — a workplace DC pension is taxed
      // identically at drawdown (same UFPLS split, same Lump Sum
      // Allowance, same MPAA/Annual Allowance rules), so there's nothing
      // to actually distinguish here.
      pensionType: "sipp",
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
      annualChargeRate: a.annualChargeRate,
      employerAnnualContribution: poundsToPence(a.employerAnnualContribution),
    }));

    const isaAccountEntities: IsaAccount[] = isaAccounts.map((a) => ({
      kind: "isa",
      id: a.id,
      owner: a.owner,
      isaType: "stocksAndShares",
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
    }));

    const giaAccountEntities: GiaAccount[] = giaAccounts.map((a) => ({
      kind: "gia",
      id: a.id,
      owner: a.owner,
      currentBalance: poundsToPence(a.currentBalance),
      costBasis: poundsToPence(a.costBasis),
      annualGrowthRate: a.annualGrowthRate,
      annualDividendYield: a.annualDividendYield,
    }));

    const cashAccountEntities: CashAccount[] = cashAccounts.map((a) => ({
      kind: "cash",
      id: a.id,
      owner: a.owner,
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
    }));

    const propertyEntities: Property[] = properties.map((a) => ({
      kind: "property",
      id: a.id,
      owner: a.owner,
      propertyType: a.propertyType,
      currentBalance: poundsToPence(a.currentBalance),
      annualGrowthRate: a.annualGrowthRate,
      purchasePrice: poundsToPence(a.purchasePrice),
      purchaseDate: a.purchaseDate,
      ...(a.propertyType === "rental"
        ? {
            rentalDetails: {
              grossAnnualRentalIncome: poundsToPence(a.grossAnnualRentalIncome),
              lettingCosts: poundsToPence(a.lettingCosts),
              annualGrowthRate: a.rentalGrowthRate,
            },
          }
        : {}),
      ...(a.hasMortgage
        ? {
            mortgage: {
              initialBalance: poundsToPence(a.mortgageInitialBalance),
              nominalInterestRate: a.mortgageNominalInterestRate,
              repaymentType: a.mortgageRepaymentType,
              termYears: a.mortgageTermYears,
              annualPayment: poundsToPence(a.mortgageAnnualPayment),
            },
          }
        : {}),
      ...(a.hasPlannedSale && a.saleDate
        ? {
            plannedSale: {
              saleDate: a.saleDate,
              sellingCosts: poundsToPence(a.sellingCosts),
              ...(a.expectedSalePrice > 0 ? { expectedSalePrice: poundsToPence(a.expectedSalePrice) } : {}),
              ...(a.destinationAccountId ? { destinationAccountId: a.destinationAccountId } : {}),
            },
          }
        : {}),
    }));

    return {
      schemaVersion: 1,
      household,
      accounts: [...pensionAccountEntities, ...isaAccountEntities, ...giaAccountEntities, ...cashAccountEntities, ...propertyEntities],
      incomeSources: [drawdownTarget, ...incomeSources],
      incomeDrains,
      inflationRate,
      upratingPolicy: { kind: "inflationLinked" },
      projectionYears,
    };
  };

  // Recomputed on every edit (no separate "submit" step) — `canSubmit`
  // and every piece of state `buildScenario` reads from are the
  // dependencies, so this only produces a new Scenario when something
  // the user actually changed. Pushed to the shared store below, which
  // is what both `ProjectionResults` (this page's main area) and the
  // Tax Breakdown page read from.
  const liveScenario = useMemo(
    () => (canSubmit ? buildScenario() : null),
    [
      canSubmit,
      dateOfBirth,
      statePensionAge,
      inflationRate,
      projectionYears,
      hasSecondPerson,
      personBDateOfBirth,
      personBStatePensionAge,
      relationshipStatus,
      marriageAllowanceElection,
      pensionAccounts,
      isaAccounts,
      giaAccounts,
      cashAccounts,
      properties,
      drawdownTarget,
      incomeSources,
      incomeDrains,
    ],
  );

  useEffect(() => {
    if (liveScenario) setScenario(liveScenario);
  }, [liveScenario, setScenario]);

  return (
    <AppShell
      header={{ height: 56 }}
      navbar={{ width: 460, breakpoint: "sm", collapsed: { mobile: !navOpened } }}
      footer={{ height: 44 }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Burger opened={navOpened} onClick={toggleNav} hiddenFrom="sm" size="sm" />
            <Title order={3}>Can I Stop</Title>
            <Text c="dimmed" size="sm" visibleFrom="xs">
              Your plan
            </Text>
          </Group>
          <Group gap="xs">
            <PlanFileControls />
            <ColorSchemeToggle />
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="md">
        <ScrollArea offsetScrollbars="y">
          <Stack gap="xl" pb="xl">
            <Stack gap="sm">
              <Title order={4}>About you</Title>
        <TextInput
          type="date"
          label="Date of birth"
          required
          value={dateOfBirth}
          onChange={(e) => setDateOfBirth(e.currentTarget.value)}
        />
        <NumberInput
          label={
            <Group gap={4} wrap="nowrap">
              <span>State Pension age</span>
              <InfoTip>Find this on gov.uk&rsquo;s &ldquo;Check your State Pension forecast&rdquo; page. Defaults to 67 if left blank.</InfoTip>
            </Group>
          }
          value={statePensionAge}
          onChange={(v) => setStatePensionAge(typeof v === "number" ? v : DEFAULT_STATE_PENSION_AGE)}
        />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Household</Title>
        <Switch
          label={
            <Group gap={4} wrap="nowrap">
              <span>Plan for two people</span>
              <InfoTip>Adds a second person — every account and cash flow can then be owned by either of you, or jointly.</InfoTip>
            </Group>
          }
          checked={hasSecondPerson}
          onChange={(e) => {
            const checked = e.currentTarget.checked;
            setHasSecondPerson(checked);
            // The target's owner selector is only shown once a second
            // person exists, so it can only still be at its single-person
            // default ("Me") right as one gets added — safe to promote to
            // "Joint" here so a partner's income is netted against it
            // without the user needing to discover the owner selector.
            if (checked && drawdownTarget.owner === PERSON_ID) {
              setDrawdownTarget({ ...drawdownTarget, owner: "joint" });
            }
          }}
        />
        {hasSecondPerson && (
          <>
            <TextInput
              type="date"
              label="Their date of birth"
              required
              value={personBDateOfBirth}
              onChange={(e) => setPersonBDateOfBirth(e.currentTarget.value)}
            />
            <NumberInput
              label="Their State Pension age"
              description="Defaults to 67 if you don't know it"
              value={personBStatePensionAge}
              onChange={(v) => setPersonBStatePensionAge(typeof v === "number" ? v : DEFAULT_STATE_PENSION_AGE)}
            />
            <Select
              label={
                <Group gap={4} wrap="nowrap">
                  <span>Relationship status</span>
                  <InfoTip>Married/civil partnership households can access Marriage Allowance and tax-free asset transfers between partners.</InfoTip>
                </Group>
              }
              data={[
                { value: "unmarried", label: "Unmarried (co-habiting)" },
                { value: "marriedOrCivilPartnership", label: "Married / civil partnership" },
              ]}
              value={relationshipStatus ?? "unmarried"}
              onChange={(v) => setRelationshipStatus(v === "marriedOrCivilPartnership" ? "marriedOrCivilPartnership" : "unmarried")}
            />
            {relationshipStatus === "marriedOrCivilPartnership" && (
              <Select
                label={
                  <Group gap={4} wrap="nowrap">
                    <span>Marriage Allowance</span>
                    <InfoTip>One partner can transfer 10% of their Personal Allowance to the other each year, if eligible. Leave blank for no election.</InfoTip>
                  </Group>
                }
                data={[
                  { value: "me", label: "I transfer to them" },
                  { value: "partner", label: "They transfer to me" },
                ]}
                value={marriageAllowanceElection ?? null}
                onChange={(v) => setMarriageAllowanceElection(v === "me" || v === "partner" ? personId(v) : undefined)}
                clearable
              />
            )}
          </>
        )}
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Assumptions</Title>
        <NumberInput
          label={
            <Group gap={4} wrap="nowrap">
              <span>Inflation rate</span>
              <InfoTip>Converts every growth rate you enter into today&rsquo;s-money terms automatically — enter the nominal rate you&rsquo;d naturally quote.</InfoTip>
            </Group>
          }
          rightSection="%"
          decimalScale={2}
          value={inflationRate * 100}
          onChange={(v) => setInflationRate(typeof v === "number" ? v / 100 : 0)}
        />
        <NumberInput
          label={
            <Group gap={4} wrap="nowrap">
              <span>Projection length (years)</span>
              <InfoTip>Shortens the table/chart to a more readable window — it can never run longer than everyone&rsquo;s own assumed lifespan, only shorter.</InfoTip>
            </Group>
          }
          min={1}
          value={projectionYears}
          onChange={(v) => setProjectionYears(typeof v === "number" ? v : DEFAULT_PROJECTION_YEARS)}
        />
      </Stack>

      <DrawdownTargetSection
        instance={drawdownTarget}
        pensionAccounts={pensionAccounts}
        isaAccounts={isaAccounts}
        giaAccounts={giaAccounts}
        cashAccounts={cashAccounts}
        hasSecondPerson={hasSecondPerson}
        inflationRate={inflationRate}
        onChange={setDrawdownTarget}
      />

      <Stack gap="sm">
        <Title order={4}>Accounts</Title>
        <Text size="sm" c="dimmed">
          Add each pension, ISA, GIA, or cash account you hold — none are required.
        </Text>

        {pensionAccounts.map((account) => (
          <PensionAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            hasSecondPerson={hasSecondPerson}
            onChange={(updated) => setPensionAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setPensionAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}
        {isaAccounts.map((account) => (
          <IsaAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            hasSecondPerson={hasSecondPerson}
            onChange={(updated) => setIsaAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setIsaAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}
        {giaAccounts.map((account) => (
          <GiaAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            hasSecondPerson={hasSecondPerson}
            onChange={(updated) => setGiaAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setGiaAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}
        {cashAccounts.map((account) => (
          <CashAccountCard
            key={account.id}
            account={account}
            inflationRate={inflationRate}
            hasSecondPerson={hasSecondPerson}
            onChange={(updated) => setCashAccounts((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setCashAccounts((prev) => prev.filter((a) => a.id !== account.id))}
          />
        ))}
        {properties.map((property) => (
          <PropertyAccountCard
            key={property.id}
            property={property}
            inflationRate={inflationRate}
            hasSecondPerson={hasSecondPerson}
            dateOfBirth={dateOfBirth}
            personBDateOfBirth={personBDateOfBirth}
            isaAccounts={isaAccounts}
            giaAccounts={giaAccounts}
            cashAccounts={cashAccounts}
            onChange={(updated) => setProperties((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))}
            onRemove={() => setProperties((prev) => prev.filter((a) => a.id !== property.id))}
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
                  owner: PERSON_ID,
                  currentBalance: 0,
                  annualGrowthRate: 0,
                  annualChargeRate: 0.0005,
                  employerAnnualContribution: 0,
                },
              ])
            }
          >
            + Add pension
          </Button>
          <Button
            variant="light"
            onClick={() =>
              setIsaAccounts((prev) => [...prev, { id: generateId("isa"), owner: PERSON_ID, currentBalance: 0, annualGrowthRate: 0 }])
            }
          >
            + Add ISA
          </Button>
          <Button
            variant="light"
            onClick={() =>
              setGiaAccounts((prev) => [
                ...prev,
                { id: generateId("gia"), owner: PERSON_ID, currentBalance: 0, costBasis: 0, annualGrowthRate: 0, annualDividendYield: 0 },
              ])
            }
          >
            + Add GIA
          </Button>
          <Button
            variant="light"
            onClick={() =>
              setCashAccounts((prev) => [
                ...prev,
                { id: generateId("cash"), owner: PERSON_ID, currentBalance: 0, annualGrowthRate: 0 },
              ])
            }
          >
            + Add cash savings
          </Button>
          <Button
            variant="light"
            onClick={() =>
              setProperties((prev) => [
                ...prev,
                {
                  id: generateId("property"),
                  owner: PERSON_ID,
                  propertyType: "mainResidence",
                  currentBalance: 0,
                  annualGrowthRate: 0,
                  purchasePrice: 0,
                  purchaseDate: "",
                  grossAnnualRentalIncome: 0,
                  lettingCosts: 0,
                  rentalGrowthRate: 0,
                  hasMortgage: false,
                  mortgageInitialBalance: 0,
                  mortgageNominalInterestRate: 0,
                  mortgageRepaymentType: "repayment",
                  mortgageTermYears: 25,
                  mortgageAnnualPayment: 0,
                  hasPlannedSale: false,
                  saleDate: "",
                  expectedSalePrice: 0,
                  sellingCosts: 0,
                  destinationAccountId: undefined,
                },
              ])
            }
          >
            + Add property
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
            giaAccounts={giaAccounts}
            cashAccounts={cashAccounts}
            properties={properties}
            hasSecondPerson={hasSecondPerson}
            inflationRate={inflationRate}
            dateOfBirth={dateOfBirth}
            personBDateOfBirth={personBDateOfBirth}
            onChange={(updated) => setIncomeSources((prev) => prev.map((s) => (s.id === updated.id ? (updated as IncomeSourceInstance) : s)))}
            onRemove={() => setIncomeSources((prev) => prev.filter((s) => s.id !== source.id))}
          />
        ))}
        <CatalogPicker kind="source" onSelect={addIncomeSource} excludeTypes={["targetDrawdownIncome"]} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Outgoings</Title>
        <Text size="sm" c="dimmed">
          Same here — add a drain only if you have one.
        </Text>
        {incomeDrains.map((drain) => (
          <CatalogInstanceCard
            key={drain.id}
            instance={drain}
            kind="drain"
            pensionAccounts={pensionAccounts}
            isaAccounts={isaAccounts}
            giaAccounts={giaAccounts}
            cashAccounts={cashAccounts}
            properties={properties}
            hasSecondPerson={hasSecondPerson}
            inflationRate={inflationRate}
            dateOfBirth={dateOfBirth}
            personBDateOfBirth={personBDateOfBirth}
            onChange={(updated) => setIncomeDrains((prev) => prev.map((d) => (d.id === updated.id ? (updated as IncomeDrainInstance) : d)))}
            onRemove={() => setIncomeDrains((prev) => prev.filter((d) => d.id !== drain.id))}
          />
        ))}
            <CatalogPicker kind="drain" onSelect={addIncomeDrain} />
            </Stack>
          </Stack>
        </ScrollArea>
      </AppShell.Navbar>

      <AppShell.Main>
        <ProjectionResults scenario={liveScenario} />
      </AppShell.Main>

      <AppShell.Footer>
        <Group h="100%" px="md">
          <Text c="dimmed" size="xs">
            Figures are estimates from a personal project and may be wrong — don&rsquo;t rely on them as your only source for real financial decisions.
          </Text>
        </Group>
      </AppShell.Footer>
    </AppShell>
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

/**
 * Owner selector shared by every account/catalog-instance card — only
 * rendered when the household has a second person (SPEC.md §3.1).
 * Pensions/ISAs can never be jointly held (SPEC.md §3.4–3.5), so
 * `allowJoint` is false for those two cards specifically.
 */
function OwnerSelect({ owner, allowJoint, onChange }: { readonly owner: Owner; readonly allowJoint: boolean; readonly onChange: (owner: Owner) => void }) {
  return (
    <Select
      label="Owner"
      data={[
        { value: PERSON_ID, label: "Me" },
        { value: PERSON_B_ID, label: "Them" },
        ...(allowJoint ? [{ value: "joint", label: "Joint" }] : []),
      ]}
      value={owner}
      onChange={(v) => onChange((v === PERSON_B_ID || (allowJoint && v === "joint") ? v : PERSON_ID) as Owner)}
    />
  );
}

/**
 * The drawdown income target — how much someone actually wants to live
 * on — is the single most important input in the whole plan (SPEC.md
 * §5.7.1): every other figure in the results pane is really just "can
 * this number actually be sustained." Given its own permanent section
 * above Accounts, rather than being one option among many in the
 * generic "+ Add income source" picker where it previously read as an
 * optional extra. There is always exactly one instance (never added or
 * removed here, unlike every other catalog-backed section on this
 * page) — still the same `targetDrawdownIncome` catalog type/engine
 * mechanics underneath (SPEC.md §9.4), spliced back into
 * `Scenario.incomeSources` in `buildScenario`.
 */
function DrawdownTargetSection({
  instance,
  pensionAccounts,
  isaAccounts,
  giaAccounts,
  cashAccounts,
  hasSecondPerson,
  inflationRate,
  onChange,
}: {
  readonly instance: IncomeSourceInstance;
  readonly pensionAccounts: readonly PensionAccountDraft[];
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly giaAccounts: readonly GiaAccountDraft[];
  readonly cashAccounts: readonly CashAccountDraft[];
  readonly hasSecondPerson: boolean;
  readonly inflationRate: number;
  readonly onChange: (instance: IncomeSourceInstance) => void;
}) {
  const definition = registry.getIncomeSource("targetDrawdownIncome");
  const isJoint = instance.owner === "joint";

  // Every pension/ISA/cash/GIA this instance can reach is pooled and
  // drawn from automatically — there's no account-picker field to filter
  // in or out any more (`simulation/runProjection.ts`'s `discoverAccountIds`
  // does the discovery). Household-split-strategy fields only apply to a
  // joint target, and `customFirstPersonShare` only once "custom" is picked.
  // `taxableDrawdownPreference` renders in its own dedicated card below,
  // not in this main field list — see "How to draw it down".
  const fields = definition.fields.filter((field) => {
    if (field.key === "taxableDrawdownPreference") return false;
    const splitStrategyFields = ["householdSplitStrategy", "customFirstPersonShare"];
    if (!isJoint && splitStrategyFields.includes(field.key)) return false;
    if (field.key === "customFirstPersonShare") {
      const config = instance.config as { readonly householdSplitStrategy?: string };
      return config.householdSplitStrategy === "custom";
    }
    return true;
  });
  const preferenceField = definition.fields.find((field) => field.key === "taxableDrawdownPreference");

  const hasAnyAccount = pensionAccounts.length > 0 || isaAccounts.length > 0 || giaAccounts.length > 0 || cashAccounts.length > 0;

  return (
    <Stack gap="sm">
      <Group gap={4}>
        <Title order={4}>Retirement income target</Title>
        <InfoTip>
          Your total desired income each year, from every source combined — salary, State Pension, rental profit,
          and drawdown. Automatic income counts toward it first; the engine only draws down whatever gap is left. For
          example, £30,000 salary with a £50,000 target means £20,000 drawn from savings. Reaching this figure counts
          as spent, so you don&rsquo;t need to separately add Living Expenses unless your actual spending genuinely
          differs from it.
        </InfoTip>
      </Group>
      <Text size="sm" c="dimmed">
        Your total desired income each year, from every source combined.
      </Text>
      {hasSecondPerson && <OwnerSelect owner={instance.owner} allowJoint onChange={(owner) => onChange({ ...instance, owner })} />}
      {isJoint && (
        <Text size="xs" c="dimmed">
          Draws from each of your own accounts automatically, split for the lowest combined tax.
        </Text>
      )}
      {!hasAnyAccount && (
        <Text size="sm" c="orange.7">
          Add an account below for this to actually have something to draw from.
        </Text>
      )}
      <CatalogItemForm
        fields={fields}
        value={instance.config as Record<string, unknown>}
        inflationRate={inflationRate}
        onChange={(config) => onChange({ ...instance, config })}
      />
      {preferenceField && (
        <Card withBorder padding="sm" bg="var(--mantine-color-gray-light)">
          <Stack gap="xs">
            <Group gap={4}>
              <Text fw={600} size="sm">
                How to draw it down (optional)
              </Text>
              <InfoTip>
                By default the engine finds the most tax-efficient mix automatically. Set an amount only if
                you&rsquo;d rather steer more (or less) of your income through your pension — e.g. to preserve it for
                later, or run it down faster. The rest is drawn from ISA, cash, and GIA first; your pension covers
                anything they can&rsquo;t.
              </InfoTip>
            </Group>
            <Text size="xs" c="dimmed">
              Leave blank to let the engine find the most tax-efficient mix automatically.
            </Text>
            <CatalogItemForm
              fields={[preferenceField]}
              value={instance.config as Record<string, unknown>}
              inflationRate={inflationRate}
              onChange={(config) => onChange({ ...instance, config })}
            />
          </Stack>
        </Card>
      )}
    </Stack>
  );
}

function PensionAccountCard({
  account,
  inflationRate,
  hasSecondPerson,
  onChange,
  onRemove,
}: {
  readonly account: PensionAccountDraft;
  readonly inflationRate: number;
  readonly hasSecondPerson: boolean;
  readonly onChange: (account: PensionAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        {/* Only SIPPs are modelled — see the "sipp" comment in buildScenario() for why. */}
        <Text fw={600}>SIPP Pension</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove pension account">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        {hasSecondPerson && <OwnerSelect owner={account.owner} allowJoint={false} onChange={(owner) => onChange({ ...account, owner: owner as PersonId })} />}
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
          label={
            <Group gap={4} wrap="nowrap">
              <span>Employer contribution (per year)</span>
              <InfoTip>
                Paid directly by your employer, on top of anything you contribute yourself. Never taxed as your
                income, but counts toward your Annual Allowance.
              </InfoTip>
            </Group>
          }
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
  hasSecondPerson,
  onChange,
  onRemove,
}: {
  readonly account: IsaAccountDraft;
  readonly inflationRate: number;
  readonly hasSecondPerson: boolean;
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
        {hasSecondPerson && <OwnerSelect owner={account.owner} allowJoint={false} onChange={(owner) => onChange({ ...account, owner: owner as PersonId })} />}
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

function GiaAccountCard({
  account,
  inflationRate,
  hasSecondPerson,
  onChange,
  onRemove,
}: {
  readonly account: GiaAccountDraft;
  readonly inflationRate: number;
  readonly hasSecondPerson: boolean;
  readonly onChange: (account: GiaAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>General Investment Account</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove General Investment Account">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        {hasSecondPerson && <OwnerSelect owner={account.owner} allowJoint onChange={(owner) => onChange({ ...account, owner })} />}
        <NumberInput
          label="Current balance"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.currentBalance}
          onChange={(v) => onChange({ ...account, currentBalance: typeof v === "number" ? v : 0 })}
        />
        <NumberInput
          label="Cost basis"
          description="How much you originally paid in, in total — used for a future capital gains calculation when you draw this down"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.costBasis}
          onChange={(v) => onChange({ ...account, costBasis: typeof v === "number" ? v : 0 })}
        />
        <GrowthRateInput
          label="Expected annual capital growth"
          realValue={account.annualGrowthRate}
          inflationRate={inflationRate}
          onChange={(v) => onChange({ ...account, annualGrowthRate: v })}
        />
        <NumberInput
          label="Dividend yield"
          description="The portion of return paid out as dividends each year — taxed annually and reinvested"
          rightSection="%"
          decimalScale={2}
          value={account.annualDividendYield * 100}
          onChange={(v) => onChange({ ...account, annualDividendYield: typeof v === "number" ? v / 100 : 0 })}
        />
      </Stack>
    </Card>
  );
}

function CashAccountCard({
  account,
  inflationRate,
  hasSecondPerson,
  onChange,
  onRemove,
}: {
  readonly account: CashAccountDraft;
  readonly inflationRate: number;
  readonly hasSecondPerson: boolean;
  readonly onChange: (account: CashAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Cash savings</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove cash savings account">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        {hasSecondPerson && <OwnerSelect owner={account.owner} allowJoint onChange={(owner) => onChange({ ...account, owner })} />}
        <NumberInput
          label="Current balance"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={account.currentBalance}
          onChange={(v) => onChange({ ...account, currentBalance: typeof v === "number" ? v : 0 })}
        />
        <GrowthRateInput
          label="Interest rate"
          realValue={account.annualGrowthRate}
          inflationRate={inflationRate}
          onChange={(v) => onChange({ ...account, annualGrowthRate: v })}
        />
      </Stack>
    </Card>
  );
}

/**
 * A property is a hand-written Account card, not a catalog type (SPEC.md
 * §3.8/§8) — it embeds an optional `Mortgage` and, for a rental, its own
 * rental details, both driven by inline toggles here rather than three
 * separate cards. Mortgage rate/payment fields are genuinely nominal
 * (never Fisher-converted, unlike every other rate on this page — see
 * `Mortgage`'s doc comment in schema/types.ts), so they deliberately skip
 * `GrowthRateInput`.
 */
function PropertyAccountCard({
  property,
  inflationRate,
  hasSecondPerson,
  dateOfBirth,
  personBDateOfBirth,
  isaAccounts,
  giaAccounts,
  cashAccounts,
  onChange,
  onRemove,
}: {
  readonly property: PropertyAccountDraft;
  readonly inflationRate: number;
  readonly hasSecondPerson: boolean;
  readonly dateOfBirth: string;
  readonly personBDateOfBirth: string;
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly giaAccounts: readonly GiaAccountDraft[];
  readonly cashAccounts: readonly CashAccountDraft[];
  readonly onChange: (property: PropertyAccountDraft) => void;
  readonly onRemove: () => void;
}) {
  const ownerDob = property.owner === "joint" ? undefined : (property.owner === PERSON_B_ID ? personBDateOfBirth : dateOfBirth) || undefined;
  const suggestedPayment =
    property.mortgageRepaymentType === "repayment"
      ? penceToPounds(
          deriveAnnualRepaymentMortgagePayment(
            poundsToPence(property.mortgageInitialBalance),
            property.mortgageNominalInterestRate,
            property.mortgageTermYears,
          ),
        )
      : property.mortgageInitialBalance * property.mortgageNominalInterestRate;

  return (
    <Card withBorder padding="sm">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>Property</Text>
        <ActionIcon variant="subtle" color="red" onClick={onRemove} aria-label="Remove property">
          ✕
        </ActionIcon>
      </Group>
      <Stack gap="sm">
        {hasSecondPerson && <OwnerSelect owner={property.owner} allowJoint onChange={(owner) => onChange({ ...property, owner })} />}
        <Select
          label="Type"
          data={[
            { value: "mainResidence", label: "Main residence" },
            { value: "rental", label: "Rental / buy-to-let" },
          ]}
          value={property.propertyType}
          onChange={(v) => onChange({ ...property, propertyType: v === "rental" ? "rental" : "mainResidence" })}
        />
        <NumberInput
          label="Current value"
          leftSection="£"
          decimalScale={2}
          thousandSeparator=","
          value={property.currentBalance}
          onChange={(v) => onChange({ ...property, currentBalance: typeof v === "number" ? v : 0 })}
        />
        <GrowthRateInput
          label="Expected annual house price growth"
          realValue={property.annualGrowthRate}
          inflationRate={inflationRate}
          onChange={(v) => onChange({ ...property, annualGrowthRate: v })}
        />
        <Group grow>
          <NumberInput
            label="Purchase price"
            leftSection="£"
            decimalScale={2}
            thousandSeparator=","
            value={property.purchasePrice}
            onChange={(v) => onChange({ ...property, purchasePrice: typeof v === "number" ? v : 0 })}
          />
          <AgeOrDateInput
            label="Purchase date"
            description="Used as the CGT cost basis if this is ever sold"
            value={property.purchaseDate}
            dateOfBirth={ownerDob}
            onChange={(v) => onChange({ ...property, purchaseDate: v })}
          />
        </Group>

        {property.propertyType === "rental" && (
          <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
            <Text fw={500} size="sm" mb="xs">
              Rental details
            </Text>
            <Stack gap="sm">
              <Group grow>
                <NumberInput
                  label="Gross annual rental income"
                  leftSection="£"
                  decimalScale={2}
                  thousandSeparator=","
                  value={property.grossAnnualRentalIncome}
                  onChange={(v) => onChange({ ...property, grossAnnualRentalIncome: typeof v === "number" ? v : 0 })}
                />
                <NumberInput
                  label="Letting costs (per year)"
                  description="Management fees, maintenance, insurance, etc."
                  leftSection="£"
                  decimalScale={2}
                  thousandSeparator=","
                  value={property.lettingCosts}
                  onChange={(v) => onChange({ ...property, lettingCosts: typeof v === "number" ? v : 0 })}
                />
              </Group>
              <GrowthRateInput
                label="Expected annual rental growth"
                realValue={property.rentalGrowthRate}
                inflationRate={inflationRate}
                onChange={(v) => onChange({ ...property, rentalGrowthRate: v })}
              />
              <Text size="xs" c="dimmed">
                Add a &ldquo;Rental income&rdquo; income source below, linked to this property, for it to count
                toward your projection.
              </Text>
            </Stack>
          </Card>
        )}

        <Switch
          label="Has a mortgage"
          checked={property.hasMortgage}
          onChange={(e) => onChange({ ...property, hasMortgage: e.currentTarget.checked })}
        />
        {property.hasMortgage && (
          <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
            <Text fw={500} size="sm" mb="xs">
              Mortgage
            </Text>
            <Stack gap="sm">
              <NumberInput
                label="Outstanding balance"
                leftSection="£"
                decimalScale={2}
                thousandSeparator=","
                value={property.mortgageInitialBalance}
                onChange={(v) => onChange({ ...property, mortgageInitialBalance: typeof v === "number" ? v : 0 })}
              />
              <NumberInput
                label="Interest rate"
                description="A genuine nominal contract rate — not adjusted for inflation, unlike every other rate on this page"
                rightSection="%"
                decimalScale={2}
                value={property.mortgageNominalInterestRate * 100}
                onChange={(v) => onChange({ ...property, mortgageNominalInterestRate: typeof v === "number" ? v / 100 : 0 })}
              />
              <Group grow>
                <Select
                  label="Repayment type"
                  data={[
                    { value: "repayment", label: "Repayment" },
                    { value: "interestOnly", label: "Interest-only" },
                  ]}
                  value={property.mortgageRepaymentType}
                  onChange={(v) => onChange({ ...property, mortgageRepaymentType: v === "interestOnly" ? "interestOnly" : "repayment" })}
                />
                <NumberInput
                  label="Remaining term (years)"
                  value={property.mortgageTermYears}
                  onChange={(v) => onChange({ ...property, mortgageTermYears: typeof v === "number" ? v : 0 })}
                />
              </Group>
              <NumberInput
                label="Annual payment"
                description={`Fixed for the whole term — suggested from balance/rate/term: £${suggestedPayment.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                leftSection="£"
                decimalScale={2}
                thousandSeparator=","
                value={property.mortgageAnnualPayment}
                onChange={(v) => onChange({ ...property, mortgageAnnualPayment: typeof v === "number" ? v : 0 })}
              />
              <Button variant="subtle" size="xs" onClick={() => onChange({ ...property, mortgageAnnualPayment: Math.round(suggestedPayment * 100) / 100 })}>
                Use suggested payment
              </Button>
            </Stack>
          </Card>
        )}

        <Switch
          label="Has a planned sale"
          checked={property.hasPlannedSale}
          onChange={(e) => onChange({ ...property, hasPlannedSale: e.currentTarget.checked })}
        />
        {property.hasPlannedSale && (
          <Card withBorder padding="sm" bg="var(--mantine-color-default-hover)">
            <Text fw={500} size="sm" mb="xs">
              Planned sale
            </Text>
            <Stack gap="sm">
              <AgeOrDateInput
                label="Sale date"
                value={property.saleDate}
                dateOfBirth={ownerDob}
                onChange={(v) => onChange({ ...property, saleDate: v })}
              />
              <NumberInput
                label="Expected sale price"
                description="Leave at £0 to grow the current value to the sale date at the house price growth rate instead"
                leftSection="£"
                decimalScale={2}
                thousandSeparator=","
                value={property.expectedSalePrice}
                onChange={(v) => onChange({ ...property, expectedSalePrice: typeof v === "number" ? v : 0 })}
              />
              <NumberInput
                label="Selling costs"
                description="Agent and legal fees"
                leftSection="£"
                decimalScale={2}
                thousandSeparator=","
                value={property.sellingCosts}
                onChange={(v) => onChange({ ...property, sellingCosts: typeof v === "number" ? v : 0 })}
              />
              <Select
                label="Pay proceeds into (optional)"
                description="Leave blank for the default — just ordinary spendable income for that year"
                data={[
                  ...isaAccounts.map((a) => ({ value: a.id, label: `ISA (£${a.currentBalance.toLocaleString()})` })),
                  ...giaAccounts.map((a) => ({ value: a.id, label: `GIA (£${a.currentBalance.toLocaleString()})` })),
                  ...cashAccounts.map((a) => ({ value: a.id, label: `Cash (£${a.currentBalance.toLocaleString()})` })),
                ]}
                value={property.destinationAccountId ?? null}
                onChange={(v) => onChange({ ...property, destinationAccountId: v ?? undefined })}
                clearable
              />
            </Stack>
          </Card>
        )}
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
/** Catalog types that can only ever be owned by a specific person, never jointly (SPEC.md §3.2, §3.3, §3.4, §3.5 — State Pension is explicitly per-person, calculated from each person's own NI record, with no joint/shared State Pension in the UK system at all). */
const PERSON_ONLY_CATALOG_TYPES = new Set(["salary", "pensionContribution", "isaContribution", "statePension"]);

function CatalogInstanceCard({
  instance,
  kind,
  pensionAccounts,
  isaAccounts,
  giaAccounts,
  cashAccounts,
  properties,
  hasSecondPerson,
  inflationRate,
  dateOfBirth,
  personBDateOfBirth,
  onChange,
  onRemove,
}: {
  readonly instance: IncomeSourceInstance | IncomeDrainInstance;
  readonly kind: "source" | "drain";
  readonly pensionAccounts: readonly PensionAccountDraft[];
  readonly isaAccounts: readonly IsaAccountDraft[];
  readonly giaAccounts: readonly GiaAccountDraft[];
  readonly cashAccounts: readonly CashAccountDraft[];
  readonly properties: readonly PropertyAccountDraft[];
  readonly hasSecondPerson: boolean;
  readonly inflationRate: number;
  readonly dateOfBirth: string;
  readonly personBDateOfBirth: string;
  readonly onChange: (instance: IncomeSourceInstance | IncomeDrainInstance) => void;
  readonly onRemove: () => void;
}) {
  const definition = kind === "source" ? registry.getIncomeSource(instance.type) : registry.getIncomeDrain(instance.type);
  const ownerDob = instance.owner === "joint" ? undefined : (instance.owner === PERSON_B_ID ? personBDateOfBirth : dateOfBirth) || undefined;
  const rentalProperties = properties.filter((p) => p.propertyType === "rental");
  const allowJointOwner = !PERSON_ONLY_CATALOG_TYPES.has(instance.type);

  const fields = definition.fields
    .map((field) => {
      if (field.key === "pensionAccountId") {
        return { ...field, options: pensionAccounts.map((a) => ({ value: a.id, label: `Pension (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "isaAccountId") {
        return { ...field, options: isaAccounts.map((a) => ({ value: a.id, label: `ISA (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "giaAccountId") {
        return { ...field, options: giaAccounts.map((a) => ({ value: a.id, label: `GIA (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "cashAccountId") {
        return { ...field, options: cashAccounts.map((a) => ({ value: a.id, label: `Cash (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "propertyId") {
        // Mortgage payments can be linked to any property; rental income only to a rental one.
        const options = instance.type === "rentalIncome" ? rentalProperties : properties;
        return { ...field, options: options.map((a) => ({ value: a.id, label: `${a.propertyType === "rental" ? "Rental" : "Main residence"} (£${a.currentBalance.toLocaleString()})` })) };
      }
      if (field.key === "destinationAccountId") {
        // A one-off inflow's optional ISA/GIA/cash destination — one
        // combined picker rather than separate account-id fields, since
        // it's a single either/or choice (SPEC.md §3.9), unlike a
        // drawdown target's several independent account links.
        return {
          ...field,
          options: [
            ...isaAccounts.map((a) => ({ value: a.id, label: `ISA (£${a.currentBalance.toLocaleString()})` })),
            ...giaAccounts.map((a) => ({ value: a.id, label: `GIA (£${a.currentBalance.toLocaleString()})` })),
            ...cashAccounts.map((a) => ({ value: a.id, label: `Cash (£${a.currentBalance.toLocaleString()})` })),
          ],
        };
      }
      return field;
    });

  const needsPensionAccount = fields.some((f) => f.key === "pensionAccountId") && pensionAccounts.length === 0;
  const needsIsaAccount = fields.some((f) => f.key === "isaAccountId") && isaAccounts.length === 0;
  const needsGiaAccount = fields.some((f) => f.key === "giaAccountId") && giaAccounts.length === 0;
  const needsCashAccount = fields.some((f) => f.key === "cashAccountId") && cashAccounts.length === 0;
  const needsPropertyAccount =
    fields.some((f) => f.key === "propertyId") && (instance.type === "rentalIncome" ? rentalProperties.length === 0 : properties.length === 0);

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
      {needsGiaAccount && (
        <Text size="sm" c="orange.7" mb="xs">
          Add a General Investment Account above first.
        </Text>
      )}
      {needsCashAccount && (
        <Text size="sm" c="orange.7" mb="xs">
          Add a cash savings account above first.
        </Text>
      )}
      {needsPropertyAccount && (
        <Text size="sm" c="orange.7" mb="xs">
          Add a {instance.type === "rentalIncome" ? "rental " : ""}property account above first.
        </Text>
      )}
      {hasSecondPerson && (
        <OwnerSelect owner={instance.owner} allowJoint={allowJointOwner} onChange={(owner) => onChange({ ...instance, owner })} />
      )}
      <CatalogItemForm
        fields={fields}
        value={instance.config as Record<string, unknown>}
        inflationRate={inflationRate}
        {...(ownerDob !== undefined ? { dateOfBirth: ownerDob } : {})}
        onChange={(config) => onChange({ ...instance, config })}
      />
      {/* A one-off inflow/outflow already has its own required, single "Date" field above (SPEC.md §3.9) — a start/end *range* on top of that is meaningless for a single dated event, and confusingly duplicated the word "Date" on the same card (the segmented control's own "Date"/"Age" option labels collided with it). */}
      {instance.type !== "oneOffInflow" && instance.type !== "oneOffOutflow" && (
        <Group grow mt="sm">
          <AgeOrDateInput
            label="Starts on"
            description="Leave blank to start immediately"
            value={instance.startDate ?? ""}
            dateOfBirth={ownerDob}
            defaultMode={instance.type === "statePension" ? "age" : "date"}
            onChange={setStartDate}
          />
          <AgeOrDateInput
            label="Ends on"
            description="Leave blank for no end date"
            value={instance.endDate ?? ""}
            dateOfBirth={ownerDob}
            onChange={setEndDate}
          />
        </Group>
      )}
    </Card>
  );
}
