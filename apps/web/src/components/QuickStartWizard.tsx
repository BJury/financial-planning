import { Button, Group, List, Modal, NumberInput, Stack, Stepper, Text, TextInput, Title } from "@mantine/core";
import { useState, type ReactNode } from "react";

export interface QuickStartAnswers {
  readonly dateOfBirth: string;
  readonly retirementAge: number;
  readonly targetAnnualIncome: number; // pounds
  readonly pension: { readonly balance: number; readonly annualContribution: number };
  readonly isa: { readonly balance: number; readonly annualContribution: number };
  readonly gia: { readonly balance: number; readonly annualContribution: number };
  readonly cash: { readonly balance: number; readonly annualContribution: number };
}

function AccountStep({
  label,
  description,
  value,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly value: QuickStartAnswers["pension"];
  readonly onChange: (value: QuickStartAnswers["pension"]) => void;
}) {
  return (
    <Stack gap="sm">
      <Text size="sm" c="dimmed">
        {description}
      </Text>
      <NumberInput
        label={`How much do you currently have in ${label}?`}
        leftSection="£"
        decimalScale={2}
        thousandSeparator=","
        value={value.balance}
        onChange={(v) => onChange({ ...value, balance: typeof v === "number" ? v : 0 })}
      />
      <NumberInput
        label="How much will you contribute each year until you retire?"
        leftSection="£"
        decimalScale={2}
        thousandSeparator=","
        value={value.annualContribution}
        onChange={(v) => onChange({ ...value, annualContribution: typeof v === "number" ? v : 0 })}
      />
      <Text size="xs" c="dimmed">
        Leave both at £0 to skip this one — you can always add it later.
      </Text>
    </Stack>
  );
}

function formatMoney(amount: number): string {
  return `£${amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/**
 * A guided, step-by-step alternative to filling in "About you", the
 * Retirement income target, and every account/contribution one at a time
 * — the same handful of questions most people can answer off the top of
 * their head, applied in one go. Every value here starts pre-filled from
 * whatever's already in the plan (`existingAnswers`, computed by the
 * caller), so re-running this after already having answered it — or after
 * having hand-edited things — shows exactly what's there rather than
 * resetting to zero; "Finish" then only ever *updates* the first existing
 * item of each kind, never duplicates it (see `applyQuickStart` in
 * Onboarding.tsx, which does the actual writing).
 */
export function QuickStartWizard({
  existingAnswers,
  onClose,
  onComplete,
}: {
  readonly existingAnswers: QuickStartAnswers;
  readonly onClose: () => void;
  readonly onComplete: (answers: QuickStartAnswers) => void;
}) {
  const [answers, setAnswers] = useState<QuickStartAnswers>(existingAnswers);
  const dobStepNeeded = !existingAnswers.dateOfBirth;
  const [active, setActive] = useState(0);

  const steps: readonly { readonly key: string; readonly label: string; readonly content: ReactNode }[] = [
    ...(dobStepNeeded
      ? [
          {
            key: "dob",
            label: "About you",
            content: (
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Needed to work out ages throughout the plan.
                </Text>
                <TextInput
                  type="date"
                  label="Date of birth"
                  required
                  value={answers.dateOfBirth}
                  onChange={(e) => setAnswers({ ...answers, dateOfBirth: e.currentTarget.value })}
                />
              </Stack>
            ),
          },
        ]
      : []),
    {
      key: "goal",
      label: "Retirement goal",
      content: (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            What you&rsquo;re aiming for — every other account and contribution below builds toward this.
          </Text>
          <NumberInput
            label="At what age do you want to retire and start drawing down?"
            value={answers.retirementAge}
            onChange={(v) => setAnswers({ ...answers, retirementAge: typeof v === "number" ? v : 0 })}
            min={0}
            max={130}
          />
          <NumberInput
            label="How much income do you want each year in retirement?"
            leftSection="£"
            decimalScale={2}
            thousandSeparator=","
            value={answers.targetAnnualIncome}
            onChange={(v) => setAnswers({ ...answers, targetAnnualIncome: typeof v === "number" ? v : 0 })}
          />
        </Stack>
      ),
    },
    {
      key: "pension",
      label: "Pension",
      content: (
        <AccountStep
          label="your pension(s)"
          description="Any workplace or personal pension combined."
          value={answers.pension}
          onChange={(pension) => setAnswers({ ...answers, pension })}
        />
      ),
    },
    {
      key: "isa",
      label: "ISA",
      content: (
        <AccountStep
          label="your ISA(s)"
          description="Stocks & Shares ISA, combined if you have more than one."
          value={answers.isa}
          onChange={(isa) => setAnswers({ ...answers, isa })}
        />
      ),
    },
    {
      key: "gia",
      label: "GIA",
      content: (
        <AccountStep
          label="a General Investment Account"
          description="A taxable investment account outside a pension or ISA — leave this at £0 if you don't have one."
          value={answers.gia}
          onChange={(gia) => setAnswers({ ...answers, gia })}
        />
      ),
    },
    {
      key: "cash",
      label: "Cash",
      content: (
        <AccountStep
          label="cash savings"
          description="Easy-access savings, not tied up in an investment."
          value={answers.cash}
          onChange={(cash) => setAnswers({ ...answers, cash })}
        />
      ),
    },
    {
      key: "review",
      label: "Review",
      content: (
        <Stack gap="sm">
          <Text size="sm" c="dimmed">
            Here&rsquo;s what Quick start will set up. You can fine-tune any of it afterward.
          </Text>
          <List size="sm" spacing={4}>
            <List.Item>
              Retirement income target: {formatMoney(answers.targetAnnualIncome)}/year from age {answers.retirementAge}.
            </List.Item>
            {(answers.pension.balance > 0 || answers.pension.annualContribution > 0) && (
              <List.Item>
                Pension: {formatMoney(answers.pension.balance)} now
                {answers.pension.annualContribution > 0 ? `, ${formatMoney(answers.pension.annualContribution)}/year until then` : ""}.
              </List.Item>
            )}
            {(answers.isa.balance > 0 || answers.isa.annualContribution > 0) && (
              <List.Item>
                ISA: {formatMoney(answers.isa.balance)} now
                {answers.isa.annualContribution > 0 ? `, ${formatMoney(answers.isa.annualContribution)}/year until then` : ""}.
              </List.Item>
            )}
            {(answers.gia.balance > 0 || answers.gia.annualContribution > 0) && (
              <List.Item>
                GIA: {formatMoney(answers.gia.balance)} now
                {answers.gia.annualContribution > 0 ? `, ${formatMoney(answers.gia.annualContribution)}/year until then` : ""}.
              </List.Item>
            )}
            {(answers.cash.balance > 0 || answers.cash.annualContribution > 0) && (
              <List.Item>
                Cash: {formatMoney(answers.cash.balance)} now
                {answers.cash.annualContribution > 0 ? `, ${formatMoney(answers.cash.annualContribution)}/year until then` : ""}.
              </List.Item>
            )}
            <List.Item>Your State Pension, at the full forecast amount, if you don&rsquo;t already have one added.</List.Item>
          </List>
          <Text size="xs" c="dimmed">
            New accounts start with a 0% growth assumption and no charges beyond a pension&rsquo;s small default annual
            charge — adjust those on the account&rsquo;s own card afterward if you have a better estimate. Contributions
            are added directly as tax-free money each year, without modelling a salary or pension tax relief — for
            full accuracy on a pension, add a Salary and replace it with a proper pension contribution afterward.
          </Text>
        </Stack>
      ),
    },
  ];

  const isLastStep = active === steps.length - 1;
  const canAdvance = active > 0 || !dobStepNeeded || answers.dateOfBirth.length > 0;

  const handleFinish = () => {
    onComplete(answers);
    onClose();
  };

  const currentStep = steps[active];

  return (
    <Modal opened onClose={onClose} title="Quick start" size="lg" padding="xl">
      <Stack gap="xl">
        {/* Dots only, no per-step labels crammed onto the track — with 7
            steps, labels wrapped onto a messy second line at any
            reasonable modal width. The current step's own name is shown
            properly below instead, as a heading with room to breathe.
            Hidden below "xs" entirely — even the dots-only track still
            wraps onto two broken-looking rows on a narrow phone (mismatched
            connector lines), and the "Step X of Y" text alongside the
            heading below already conveys the same progress. */}
        <Stepper active={active} size="xs" iconSize={24} visibleFrom="xs">
          {steps.map((step) => (
            <Stepper.Step key={step.key} />
          ))}
        </Stepper>
        <Stack gap={4}>
          <Group justify="space-between" align="baseline">
            <Title order={4}>{currentStep?.label}</Title>
            <Text size="sm" c="dimmed">
              Step {active + 1} of {steps.length}
            </Text>
          </Group>
          {currentStep?.content}
        </Stack>
        <Group justify="space-between">
          <Button variant="subtle" onClick={() => setActive((prev) => Math.max(prev - 1, 0))} disabled={active === 0}>
            Back
          </Button>
          {isLastStep ? (
            <Button onClick={handleFinish}>Finish</Button>
          ) : (
            <Button onClick={() => setActive((prev) => Math.min(prev + 1, steps.length - 1))} disabled={!canAdvance}>
              Next
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
