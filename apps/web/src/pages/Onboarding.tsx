import {
  pence,
  personId,
  poundsToPence,
  registry,
  type Household,
  type IsaAccount,
  type IsaContributionConfig,
  type PensionAccount,
  type PensionContributionConfig,
  type SalaryConfig,
  type Scenario,
} from "@fp/engine";
import { Button, NumberInput, Stack, Text, TextInput, Title } from "@mantine/core";
import { useState } from "react";
import { useNavigate } from "react-router";
import { CatalogItemForm } from "../catalog-ui/CatalogItemForm.js";
import { useScenarioStore } from "../state/store.js";

const PERSON_ID = personId("me");
const PENSION_ACCOUNT_ID = "pension1";
const ISA_ACCOUNT_ID = "isa1";

const salaryDefinition = registry.getIncomeSource("salary");
const pensionContributionDefinition = registry.getIncomeDrain("pensionContribution");
const isaContributionDefinition = registry.getIncomeDrain("isaContribution");

/**
 * Phase 1's onboarding (SPEC.md §4 journey 1): single person, one Salary
 * Income Source, one pension + one ISA account/contribution — built via
 * the same generic CatalogItemForm every later phase's additional
 * catalog types will use, not a bespoke form per section.
 */
export function Onboarding() {
  const navigate = useNavigate();
  const setScenario = useScenarioStore((s) => s.setScenario);

  const [dateOfBirth, setDateOfBirth] = useState("1985-01-01");
  const [salary, setSalary] = useState<SalaryConfig>({ grossAnnualSalary: pence(0), annualGrowthRate: 0.02 });

  const [pensionStartingBalance, setPensionStartingBalance] = useState(0);
  const [pensionGrowthRate, setPensionGrowthRate] = useState(0.05);
  const [pensionChargeRate, setPensionChargeRate] = useState(0.005);
  const [pensionContribution, setPensionContribution] = useState<PensionContributionConfig>({
    pensionAccountId: PENSION_ACCOUNT_ID,
    reliefMethod: "reliefAtSource",
    annualContribution: pence(0),
  });

  const [isaStartingBalance, setIsaStartingBalance] = useState(0);
  const [isaGrowthRate, setIsaGrowthRate] = useState(0.04);
  const [isaContribution, setIsaContribution] = useState<IsaContributionConfig>({
    isaAccountId: ISA_ACCOUNT_ID,
    annualContribution: pence(0),
  });

  const handleSubmit = () => {
    const household: Household = {
      people: [{ id: PERSON_ID, dateOfBirth, targetRetirementAge: 67, projectionEndAge: 95 }],
      relationshipStatus: null,
      targetIncomeMode: "perPerson",
    };

    const pensionAccount: PensionAccount = {
      kind: "pension",
      id: PENSION_ACCOUNT_ID,
      owner: PERSON_ID,
      pensionType: "workplaceDC",
      currentBalance: poundsToPence(pensionStartingBalance),
      annualGrowthRate: pensionGrowthRate,
      annualChargeRate: pensionChargeRate,
    };

    const isaAccount: IsaAccount = {
      kind: "isa",
      id: ISA_ACCOUNT_ID,
      owner: PERSON_ID,
      isaType: "stocksAndShares",
      currentBalance: poundsToPence(isaStartingBalance),
      annualGrowthRate: isaGrowthRate,
    };

    const scenario: Scenario = {
      schemaVersion: 1,
      household,
      accounts: [pensionAccount, isaAccount],
      incomeSources: [{ id: "src-salary", type: "salary", owner: PERSON_ID, config: salary }],
      incomeDrains: [
        { id: "drain-pension", type: "pensionContribution", owner: PERSON_ID, config: pensionContribution },
        { id: "drain-isa", type: "isaContribution", owner: PERSON_ID, config: isaContribution },
      ],
      inflationRate: 0.025,
      upratingPolicy: { kind: "inflationLinked" },
    };

    setScenario(scenario);
    void navigate("/dashboard");
  };

  // pensionAccountId/isaAccountId are fixed for Phase 1 (a single account
  // of each type) — hide them from the generic form rather than making
  // the user pick from a one-item list.
  const pensionContributionFields = pensionContributionDefinition.fields.filter((f) => f.key !== "pensionAccountId" && f.key !== "reliefMethod");
  const isaContributionFields = isaContributionDefinition.fields.filter((f) => f.key !== "isaAccountId");

  return (
    <Stack maw={480} mx="auto" my="xl" gap="xl">
      <Title order={2}>Set up your plan</Title>

      <Stack gap="sm">
        <Title order={4}>About you</Title>
        <TextInput type="date" label="Date of birth" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.currentTarget.value)} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Salary</Title>
        <CatalogItemForm fields={salaryDefinition.fields} value={salary} onChange={setSalary} />
      </Stack>

      <Stack gap="sm">
        <Title order={4}>Pension</Title>
        <NumberInput label="Current pot value" leftSection="£" decimalScale={2} thousandSeparator="," value={pensionStartingBalance} onChange={(v) => setPensionStartingBalance(typeof v === "number" ? v : 0)} />
        <NumberInput label="Pension growth (real)" rightSection="%" value={pensionGrowthRate * 100} onChange={(v) => setPensionGrowthRate(typeof v === "number" ? v / 100 : 0)} />
        <NumberInput label="Annual charge" rightSection="%" value={pensionChargeRate * 100} onChange={(v) => setPensionChargeRate(typeof v === "number" ? v / 100 : 0)} />
        <CatalogItemForm fields={pensionContributionFields} value={pensionContribution} onChange={setPensionContribution} />
        <Text size="xs" c="dimmed">
          Relief-at-source: paid from your net pay; the provider claims basic-rate relief automatically.
        </Text>
      </Stack>

      <Stack gap="sm">
        <Title order={4}>ISA</Title>
        <NumberInput label="Current balance" leftSection="£" decimalScale={2} thousandSeparator="," value={isaStartingBalance} onChange={(v) => setIsaStartingBalance(typeof v === "number" ? v : 0)} />
        <NumberInput label="ISA growth (real)" rightSection="%" value={isaGrowthRate * 100} onChange={(v) => setIsaGrowthRate(typeof v === "number" ? v / 100 : 0)} />
        <CatalogItemForm fields={isaContributionFields} value={isaContribution} onChange={setIsaContribution} />
      </Stack>

      <Button onClick={handleSubmit} size="md">
        See my projection
      </Button>
    </Stack>
  );
}
