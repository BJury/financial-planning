import {
  ageAtYear,
  penceToPounds,
  subtractPence,
  sumPence,
  totalTaxForYear,
  zeroPence,
  type Account,
  type IncomeSourceInstance,
  type Owner,
  type Pence,
  type Person,
  type ProjectionResult,
  type Scenario,
  type TargetDrawdownIncomeConfig,
  type YearLedgerRow,
} from "@fp/engine";
import { Alert, Button, Center, Group, MultiSelect, Select, Stack, Table, Text, Title, useComputedColorScheme } from "@mantine/core";
import { useLocalStorage } from "@mantine/hooks";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { CartesianGrid, Legend, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { downloadCsv, projectionToCsv } from "../csvExport.js";
import { formatMoney, formatMoneyRounded, formatNumber, formatPoundsMoney } from "../format.js";
import { InfoTip } from "./InfoTip.js";
import { computeNetWorth, computeProjection } from "../projection.js";
import { GAP_ACCOUNT_KIND_LABELS, computeShortfallGaps, type ShortfallGap } from "../shortfallGap.js";

interface ChartMetric {
  readonly key: string;
  readonly label: string;
  /** A fixed colour per metric (not assigned by selection order) so a line's colour never shifts as other lines are added or removed. */
  readonly color: string;
  readonly compute: (row: YearLedgerRow) => number;
  /** Only set for a per-account metric — lets the year-by-year table pick out just the pension/ISA/GIA/cash balance columns without re-deriving account info from the key string. */
  readonly accountKind?: Account["kind"];
  /**
   * Which of the two charts this metric belongs on — a balance (net
   * worth, any single account) sits at a scale of tens/hundreds of
   * thousands, while a flow (income, tax) is typically an order of
   * magnitude or two smaller; plotted together on one axis, a flow line
   * flattens to an invisible sliver against the balances. Split into two
   * separate charts sharing the same X-axis instead of one axis trying
   * to serve both scales at once.
   */
  readonly scale: "balance" | "flow";
}

const CHART_METRICS: readonly ChartMetric[] = [
  { key: "netWorth", label: "Net worth", color: "#1c7ed6", scale: "balance", compute: (row) => penceToPounds(computeNetWorth(row)) },
  {
    key: "grossIncome",
    label: "Gross income",
    color: "#0ca678",
    scale: "flow",
    compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.grossIncome))),
  },
  {
    key: "netIncome",
    label: "Net income",
    color: "#2f9e44",
    scale: "flow",
    // Deliberately *not* the engine's own `PersonYearResult.netIncome`
    // field — that one is further reduced by auto-consumption (achieving
    // a drawdown target counts as spent, SPEC.md §5.7.2) on top of
    // expenses, so it usually settles at/near £0 and doesn't answer "how
    // much came in this year, after what went out." Recomputed here from
    // the same already-tracked per-source figures instead — after tax
    // *and* expenses (Continuous outflows, mortgage payments, one-off
    // outflows), but not auto-consumption — kept in sync with the
    // year-by-year table's own "Net income" column formula by hand since
    // there isn't a single shared helper both pull from.
    compute: (row) =>
      penceToPounds(
        subtractPence(
          sumPence(
            row.perPerson.flatMap((p) => [
              p.grossIncome,
              p.rentalProfitIncome,
              p.statePensionIncome,
              p.drawdownNetAchieved,
              p.taxFreeIncome,
              p.mortgageInterestCredit,
              p.propertySaleNetProceeds,
            ]),
          ),
          sumPence(
            row.perPerson.flatMap((p) => [
              p.incomeTax,
              p.nationalInsurance,
              p.annualAllowanceCharge,
              p.savingsTax,
              p.dividendTax,
              p.otherExpenses,
            ]),
          ),
        ),
      ),
  },
  { key: "totalTax", label: "Total tax", color: "#e03131", scale: "flow", compute: (row) => penceToPounds(totalTaxForYear(row)) },
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
  /** Overrides the group's own colour for just this one column — used by the two drawdown-source columns, which need to match the Pension/Non-taxable balance columns' colours rather than the rest of the Drawdown group's grape. */
  readonly bg?: string;
}

interface TableColumnGroup {
  readonly label: string;
  /** A Mantine "light" colour token (theme-adaptive — automatically the right shade for light vs dark mode, unlike a fixed hex) — applied to both the header and every body cell in the group, so the colour-coding reads all the way down the table, not just at the top. */
  readonly bg: string;
  readonly columns: readonly TableColumn[];
}

const EXPENSE_DRAIN_TYPES = new Set(["livingExpenses", "oneOffOutflow", "mortgagePayment"]);

/** Every `DrawdownBucket` a taxable pension withdrawal can land in (SPEC.md §5.7.3) — the four Income Tax bands, as opposed to the one tax-free UFPLS bucket. */
const TAXABLE_PENSION_BUCKETS = new Set(["taxablePersonalAllowance", "taxableBasicRate", "taxableHigherRate", "taxableAdditionalRate"]);

/** The Retirement income target section is always present (SPEC.md §5.7.1) with a £0 default — only counts as "active" once it's actually been given a real target. */
function hasActiveDrawdownTarget(scenario: Scenario): boolean {
  return scenario.incomeSources.some(
    (s) => s.type === "targetDrawdownIncome" && ((s.config as { readonly targetNetAnnualIncome?: number }).targetNetAnnualIncome ?? 0) > 0,
  );
}

/**
 * The year-by-year table's column grouping (SPEC.md §7), left to right:
 * Contributions first (right next to the balance columns further left
 * still — see that group's own doc comment for why), then "Outgoings"
 * (just Expenses now), then one "Income" group holding everything that
 * came in this year: taxable sources first (Salary, Rental profit, State
 * Pension — each already its own `PersonYearResult` field, so no engine
 * change was needed), then the one non-taxable source (Tax-free income),
 * then the drawdown source breakdown (From pension/ISA/cash/GIA), then the
 * drawdown net total, then "Income Over Target" (lime) and Net income
 * (yellow) *last*, in that order — neither is an outgoing (so neither
 * lives in "Outgoings", despite "Income Over Target" replacing what used
 * to be called Unallocated surplus there), and Outgoings still sits to
 * Income's *left* specifically so Net income (which nets out Expenses)
 * reads as a running total against a column to its own left. Every column
 * keeps its individual taxable (teal) / non-taxable (cyan) colouring via
 * its own `bg` override, even though they now share one group label; the
 * drawdown total's own grape, Income Over Target's lime, and Net income's
 * yellow set them apart as summaries, not sources. Then the tax columns.
 */
const TABLE_COLUMN_GROUPS: readonly TableColumnGroup[] = [
  {
    // Money paid into a pension/ISA/GIA/cash account each year. Placed
    // immediately to the right of the balance columns (not inside
    // "Outgoings", despite still being one of SPEC.md §9.4's Income
    // Drains under the hood) since it reads as "what's going into each
    // pot" right next to "what each pot currently holds" — and, unlike
    // Outgoings, it no longer reduces Net income/Unallocated surplus at
    // all (`runProjection.ts`'s `netIncome` calculation): a contribution
    // is treated as flowing in from outside the plan's own tracked
    // income (the same assumption an employer pension contribution
    // already made), not as a diversion of money this table has already
    // counted as earned. One column per account kind (not one combined
    // total) so each lines up with its own balance column further to its
    // left.
    label: "Contributions",
    bg: "var(--mantine-color-indigo-light)",
    columns: [
      {
        key: "pensionContributions",
        label: "Pension",
        compute: (row) => sumPence(row.perPerson.map((p) => p.pensionContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => d.type === "pensionContribution"),
      },
      {
        key: "isaContributions",
        label: "ISA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.isaContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => d.type === "isaContribution"),
      },
      {
        key: "giaContributions",
        label: "GIA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.giaContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => d.type === "giaContribution"),
      },
      {
        key: "cashContributions",
        label: "Cash",
        compute: (row) => sumPence(row.perPerson.map((p) => p.cashContributions)),
        isIncluded: (scenario) => scenario.incomeDrains.some((d) => d.type === "cashContribution"),
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
    ],
  },
  {
    label: "Income",
    bg: "var(--mantine-color-gray-light)",
    columns: [
      {
        key: "salary",
        label: "Salary",
        compute: (row) => sumPence(row.perPerson.map((p) => p.grossIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "salary"),
      },
      {
        key: "rentalProfit",
        label: "Rental profit",
        compute: (row) => sumPence(row.perPerson.map((p) => p.rentalProfitIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "rentalIncome"),
      },
      {
        key: "statePension",
        label: "State Pension",
        compute: (row) => sumPence(row.perPerson.map((p) => p.statePensionIncome)),
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "statePension"),
      },
      {
        key: "taxFreeIncome",
        label: "Tax-free income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.taxFreeIncome)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => scenario.incomeSources.some((s) => s.type === "oneOffInflow"),
      },
      {
        key: "drawdownFromPensionTaxFree",
        label: "Pension (tax-free)",
        // The UFPLS 25% share (SPEC.md §5.7.2, `tax/pensionLumpSum.ts`) —
        // already split out at the bucket level, so no engine change was
        // needed to surface it here.
        compute: (row) =>
          sumPence(row.perPerson.flatMap((p) => p.drawdownBuckets.filter((b) => b.bucket === "taxFreePensionLumpSum").map((b) => b.amount))),
        // Cyan — the same "not taxed" colour as Tax-free income/ISA/cash/GIA,
        // even though this is a pension withdrawal (source ≠ tax treatment).
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "pension"),
      },
      {
        key: "drawdownFromPensionTaxable",
        label: "Pension (taxable)",
        compute: (row) =>
          sumPence(row.perPerson.flatMap((p) => p.drawdownBuckets.filter((b) => TAXABLE_PENSION_BUCKETS.has(b.bucket)).map((b) => b.amount))),
        // Teal — matches the Pension balance column, and is taxed like
        // ordinary pension income.
        bg: "var(--mantine-color-teal-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "pension"),
      },
      {
        key: "drawdownFromIsa",
        label: "From ISA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromIsa)),
        // Coloured the same as the Non-taxable balance column.
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "isa"),
      },
      {
        key: "drawdownFromCash",
        label: "From cash",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromCash)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "cash"),
      },
      {
        key: "drawdownFromGia",
        label: "From GIA",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownFromGia)),
        bg: "var(--mantine-color-cyan-light)",
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario) && scenario.accounts.some((a) => a.kind === "gia"),
      },
      {
        key: "drawdown",
        label: "Drawdown income",
        compute: (row) => sumPence(row.perPerson.map((p) => p.drawdownNetAchieved)),
        warningFlag: (row) => row.perPerson.some((p) => p.drawdownShortfall),
        // Its own colour, not taxable/non-taxable teal/cyan — it's the
        // net total of everything drawn down this year, not one specific
        // source, so it's set apart rather than made to look like it
        // belongs to either side.
        bg: "var(--mantine-color-grape-light)",
        // The Retirement income target section is always present (SPEC.md
        // §5.7.1) with a £0 default — only counts as "included" once it's
        // actually been given a real target, not just because the
        // permanent section exists on the page.
        isIncluded: (scenario) => hasActiveDrawdownTarget(scenario),
      },
      {
        key: "unallocatedSurplus",
        label: "Income Over Target",
        // Not an outgoing — it's the slice of Net income (to its right)
        // not already implicitly claimed by a drawdown target
        // (`autoConsumption` in `runProjection.ts`): income achieved
        // beyond what the target treats as spent. Zero whenever there's
        // no active target (nothing to be "over"), which is also exactly
        // when this column and Net income coincide. Not automatically
        // invested anywhere — add a contribution to actually capture it,
        // or leave it as a visible reminder of how much headroom a plan
        // has each year. No longer reduced by contributions either (see
        // the Contributions group's own doc comment).
        compute: (row) => sumPence(row.perPerson.map((p) => p.unallocatedSurplus)),
        bg: "var(--mantine-color-lime-light)",
      },
      {
        key: "netIncome",
        label: "Net income",
        // Everything that came in this year, net of tax *and* expenses
        // (Continuous outflows, mortgage payments, one-off outflows) —
        // the true bottom line. Reads correctly against "Outgoings"
        // (Expenses) to its *left*, even though this column itself sits
        // at the end of "Income" rather than inside "Outgoings" — net
        // income is fundamentally an income concept, not an outgoing.
        // Still deliberately *not* the engine's own
        // `PersonYearResult.netIncome` field: that one is further reduced
        // by auto-consumption (achieving a drawdown target counts as
        // spent, SPEC.md §5.7.2), so it usually settles at/near £0 —
        // "Income Over Target" (lime, immediately to this column's left)
        // already covers that fully-netted, floored-at-zero figure. This
        // column recomputes from the same already-tracked per-source
        // figures instead. CHART_METRICS' own "netIncome" line (above)
        // uses this exact same formula, kept in sync by hand — no shared
        // helper exists for it yet.
        compute: (row) =>
          subtractPence(
            sumPence(
              row.perPerson.flatMap((p) => [
                p.grossIncome,
                p.rentalProfitIncome,
                p.statePensionIncome,
                p.drawdownNetAchieved,
                p.taxFreeIncome,
                p.mortgageInterestCredit,
                p.propertySaleNetProceeds,
              ]),
            ),
            sumPence(
              row.perPerson.flatMap((p) => [
                p.incomeTax,
                p.nationalInsurance,
                p.annualAllowanceCharge,
                p.savingsTax,
                p.dividendTax,
                p.otherExpenses,
              ]),
            ),
          ),
        warningFlag: (row) => row.perPerson.some((p) => p.livingExpensesShortfall),
        bg: "var(--mantine-color-yellow-light)",
      },
    ],
  },
  {
    label: "Tax",
    bg: "var(--mantine-color-red-light)",
    columns: [
      {
        key: "incomeTax",
        label: "Income Tax and NI",
        // NI folded in here rather than kept as its own column — it's
        // never interesting on its own, only as part of the total tax
        // bite on income.
        compute: (row) =>
          subtractPence(
            sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.drawdownIncomeTax, p.savingsTax, p.dividendTax, p.nationalInsurance])),
            sumPence(row.perPerson.map((p) => p.mortgageInterestCredit)),
          ),
      },
      {
        key: "cgt",
        label: "CGT",
        compute: (row) => sumPence(row.perPerson.flatMap((p) => [p.drawdownCapitalGainsTax, p.propertySaleCapitalGainsTax, p.shortfallCapitalGainsTax])),
      },
    ],
  },
];

const ACCOUNT_KIND_LABELS: Partial<Record<Account["kind"], string>> = { pension: "Pension", isa: "ISA", gia: "GIA", cash: "Cash" };

function ownerLabel(owner: Owner, people: readonly Person[]): string {
  if (owner === "joint") return "Joint";
  return people.findIndex((p) => p.id === owner) === 1 ? "Partner" : "You";
}

/**
 * What the year-by-year table's first column, and the chart's X-axis,
 * are labelled with — a single either/or choice (not "tax year plus
 * ages", the old toggle's behaviour) since showing every person's age
 * side by side stops scaling once there's more than one, and a chart
 * axis can only sensibly carry one series of tick values at a time.
 */
type RowAxisMode = "taxYear" | "myAge" | "otherAge";

function rowAxisModeOptions(people: readonly Person[]): readonly { readonly value: RowAxisMode; readonly label: string }[] {
  return [
    { value: "taxYear", label: "Tax year" },
    { value: "myAge", label: people.length > 1 ? "My age" : "Age" },
    ...(people.length > 1 ? [{ value: "otherAge" as const, label: "Their age" }] : []),
  ];
}

/** Whichever person `"myAge"`/`"otherAge"` refers to — always `people[0]`/`people[1]` (SPEC.md §3.2's "Me"/"Them" ordering), regardless of whether that person is still alive in a given row; an axis needs a value for every row to stay continuous. */
function personForRowAxisMode(axisMode: RowAxisMode, people: readonly Person[]): Person | undefined {
  if (axisMode === "myAge") return people[0];
  if (axisMode === "otherAge") return people[1];
  return undefined;
}

function rowAxisColumnLabel(axisMode: RowAxisMode, people: readonly Person[]): string {
  if (axisMode === "taxYear") return "Tax year";
  if (axisMode === "myAge") return people.length > 1 ? "Your age" : "Age";
  return "Their age";
}

function rowAxisLabel(row: YearLedgerRow, axisMode: RowAxisMode, people: readonly Person[]): string {
  const person = personForRowAxisMode(axisMode, people);
  return person ? String(ageAtYear(person.dateOfBirth, row.calendarYear)) : row.taxYear;
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
      scale: "balance" as const,
      compute: (row: YearLedgerRow) => {
        const balance = penceToPounds(row.accountBalances.get(account.id) ?? zeroPence());
        if (account.kind !== "property") return balance;
        return balance - penceToPounds(row.mortgageBalanceByPropertyId.get(account.id) ?? zeroPence());
      },
    };
  });
}

/**
 * One selectable line per income source *type* actually present in the
 * plan (not per instance — the engine's own per-year result is only
 * broken down by tax category, e.g. every Salary a person has combines
 * into one `grossIncome` figure, not one per catalog instance, so that's
 * the finest granularity available without an engine change). A one-off
 * inflow and general cash income share the same `taxFreeIncome` bucket
 * for the same reason, so they're combined into a single "Tax-free
 * income" line rather than shown as two identical-looking ones. Property
 * sale proceeds aren't included — a planned sale lives on the account
 * itself (`Property.plannedSale`), not in `scenario.incomeSources`, so it
 * isn't one of "the income sources" in the same sense as everything else
 * here.
 */
function buildIncomeSourceMetrics(scenario: Scenario): readonly ChartMetric[] {
  const types = new Set(scenario.incomeSources.map((s) => s.type));
  const metrics: ChartMetric[] = [];

  if (types.has("salary")) {
    metrics.push({
      key: "income:salary",
      label: "Salary",
      color: "#0ca678",
      scale: "flow",
      compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.grossIncome))),
    });
  }
  if (types.has("statePension")) {
    metrics.push({
      key: "income:statePension",
      label: "State Pension",
      color: "#f08c00",
      scale: "flow",
      compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.statePensionIncome))),
    });
  }
  if (types.has("rentalIncome")) {
    metrics.push({
      key: "income:rentalIncome",
      label: "Rental income",
      color: "#5c940d",
      scale: "flow",
      compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.rentalProfitIncome))),
    });
  }
  if (types.has("targetDrawdownIncome")) {
    metrics.push({
      key: "income:drawdown",
      label: "Drawdown income",
      color: "#1971c2",
      scale: "flow",
      compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.drawdownNetAchieved))),
    });
  }
  if (types.has("oneOffInflow") || types.has("generalCashIncome")) {
    metrics.push({
      key: "income:taxFree",
      label: "Tax-free income",
      color: "#ae3ec9",
      scale: "flow",
      compute: (row) => penceToPounds(sumPence(row.perPerson.map((p) => p.taxFreeIncome))),
    });
  }

  return metrics;
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
function computeKeyFlags(result: ProjectionResult | null, scenario: Scenario | null): readonly KeyFlag[] {
  if (!result) return [];
  const flags: KeyFlag[] = [];
  const firstTaxYear = result.rows[0]?.taxYear;

  if (scenario && firstTaxYear) {
    const { people } = scenario.household;
    for (const person of people) {
      const hasOwnIncome = scenario.incomeSources.some((source) => source.type !== "targetDrawdownIncome" && source.owner === person.id);
      if (!hasOwnIncome) continue;
      const isCoveredByTarget = scenario.incomeSources.some(
        (source) => source.type === "targetDrawdownIncome" && (source.owner === person.id || source.owner === "joint"),
      );
      if (!isCoveredByTarget) {
        flags.push({
          taxYear: firstTaxYear,
          message: `${ownerLabel(person.id, people)}'s income isn't covered by any drawdown target, so it won't be netted against a target's shortfall.`,
        });
      }
    }
  }

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
      message: "A pension was flexibly accessed — future pension contributions are now capped at a lower allowance.",
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

interface ChartEvent {
  readonly key: string;
  readonly taxYear: string;
  readonly label: string;
  readonly color: string;
}

/**
 * One-off, dated events (SPEC.md §3.8, §3.9), plus the one recurring
 * milestone worth marking the same way — when drawdown income first
 * actually starts — shown directly on the chart as vertical reference
 * lines. Seeing *why* net worth jumps, dips, or starts declining in a
 * given year (an inheritance landing, a house deposit paid, a property
 * sold, savings starting to be drawn down) is easy to miss buried in the
 * year-by-year table, but hard to miss as a labelled line right on the
 * graph. Maps each one-off event's own date to whichever projection
 * row's `calendarYear` it falls in, the same year-only mapping the
 * engine itself uses (no month-level precision anywhere in this app) —
 * reused here rather than re-derived, so an event's line always lines up
 * with the exact row its amount actually landed in.
 */
function buildChartEvents(scenario: Scenario, result: ProjectionResult): readonly ChartEvent[] {
  const events: ChartEvent[] = [];
  const taxYearForDate = (isoDate: string | undefined): string | undefined => {
    if (!isoDate) return undefined;
    const calendarYear = new Date(isoDate).getUTCFullYear();
    if (Number.isNaN(calendarYear)) return undefined;
    return result.rows.find((row) => row.calendarYear === calendarYear)?.taxYear;
  };

  for (const source of scenario.incomeSources) {
    if (source.type !== "oneOffInflow") continue;
    const taxYear = taxYearForDate((source.config as { readonly date?: string }).date);
    if (!taxYear) continue;
    events.push({ key: `inflow:${source.id}`, taxYear, label: "Inflow", color: "#0ca678" });
  }

  for (const drain of scenario.incomeDrains) {
    if (drain.type !== "oneOffOutflow") continue;
    const taxYear = taxYearForDate((drain.config as { readonly date?: string }).date);
    if (!taxYear) continue;
    events.push({ key: `outflow:${drain.id}`, taxYear, label: "Outflow", color: "#e8590c" });
  }

  for (const account of scenario.accounts) {
    if (account.kind !== "property" || !account.plannedSale) continue;
    const taxYear = taxYearForDate(account.plannedSale.saleDate);
    if (!taxYear) continue;
    events.push({ key: `sale:${account.id}`, taxYear, label: "Sale", color: "#7048e8" });
  }

  const { people } = scenario.household;

  // Each targetDrawdownIncome phase's own configured start/end age
  // (SPEC.md §5.7.1's step phases) — distinct from "Drawdown starts"
  // above, which marks when money is *actually* first withdrawn; this
  // instead visualises the plan's own structure, e.g. seeing exactly
  // where "£80,000 from 55, then £50,000 from 70" steps down. An end is
  // only marked when it doesn't already coincide with another phase's
  // own start for the same owner — per the engine's own implicit-next-
  // phase inference (targetDrawdownIncome.ts's nextPhaseStartAge), that's
  // not a genuine end at all, just the same transition point a "starts"
  // event for the next phase already marks; showing both would be two
  // labels for the exact same moment. The untouched £0 default phase
  // every plan starts with is skipped entirely, same as
  // `hasActiveDrawdownTarget` does elsewhere.
  const ageToTaxYear = (owner: Owner, age: number): string | undefined => {
    const person = owner === "joint" ? people[0] : people.find((p) => p.id === owner);
    if (!person) return undefined;
    const dob = new Date(person.dateOfBirth);
    if (Number.isNaN(dob.getTime())) return undefined;
    return result.rows.find((row) => row.calendarYear === dob.getUTCFullYear() + age)?.taxYear;
  };
  const drawdownPhases = scenario.incomeSources.filter(
    (s): s is IncomeSourceInstance<TargetDrawdownIncomeConfig> => s.type === "targetDrawdownIncome" && (s.config as TargetDrawdownIncomeConfig).targetNetAnnualIncome > 0,
  );
  for (const phase of drawdownPhases) {
    const config = phase.config;
    const suffix = people.length > 1 ? ` (${ownerLabel(phase.owner, people)})` : "";
    const amountLabel = `£${formatNumber(penceToPounds(config.targetNetAnnualIncome))}`;

    const startTaxYear = ageToTaxYear(phase.owner, config.startAge);
    if (startTaxYear) {
      events.push({
        key: `drawdown-phase-start:${phase.id}`,
        taxYear: startTaxYear,
        label: `${amountLabel} target starts${suffix}`,
        color: "#e64980",
      });
    }

    if (config.endAge !== undefined) {
      const chainsIntoNextPhase = drawdownPhases.some(
        (other) => other.id !== phase.id && other.owner === phase.owner && other.config.startAge === config.endAge,
      );
      const endTaxYear = chainsIntoNextPhase ? undefined : ageToTaxYear(phase.owner, config.endAge);
      if (endTaxYear) {
        events.push({
          key: `drawdown-phase-end:${phase.id}`,
          taxYear: endTaxYear,
          label: `${amountLabel} target ends${suffix}`,
          color: "#e64980",
        });
      }
    }
  }

  // Salary starting/stopping, per person. `grossIncome` is exclusively
  // earned income (SPEC.md §3.2 — Salary is the only catalog type tagged
  // `"earnedIncome"`), so a rising edge (0 to >0) marks a start and a
  // falling edge (>0 back to 0, with more years still ahead in the
  // projection) marks an end — the same "look at what the result actually
  // did, not the configured schedule" reasoning as "Drawdown starts"
  // above. Doesn't separate multiple overlapping Salary sources for the
  // same person into their own pairs; a career-break gap between two
  // Salary cards still shows its own start/end pair either way, since
  // only the combined total per year matters here.
  for (const person of people) {
    let previouslyActive = false;
    result.rows.forEach((row, index) => {
      const active = row.perPerson.some((p) => p.personId === person.id && p.grossIncome > 0);
      const suffix = people.length > 1 ? ` (${ownerLabel(person.id, people)})` : "";
      if (active && !previouslyActive) {
        events.push({ key: `salary-start:${person.id}:${row.taxYear}`, taxYear: row.taxYear, label: `Salary starts${suffix}`, color: "#2b8a3e" });
      } else if (!active && previouslyActive) {
        const endedRow = result.rows[index - 1];
        if (endedRow) {
          events.push({ key: `salary-end:${person.id}:${endedRow.taxYear}`, taxYear: endedRow.taxYear, label: `Salary ends${suffix}`, color: "#2b8a3e" });
        }
      }
      previouslyActive = active;
    });
  }

  // Actual State Pension income only, not the configured State Pension
  // Age — matches the "Drawdown starts" reasoning above (a person can
  // reach State Pension Age with the amount already folded into other
  // covered income for display purposes elsewhere, but here we're
  // marking the year the income itself is first present in the result).
  for (const person of people) {
    const firstYear = result.rows.find((row) => row.perPerson.some((p) => p.personId === person.id && p.statePensionIncome > 0));
    if (!firstYear) continue;
    const suffix = people.length > 1 ? ` (${ownerLabel(person.id, people)})` : "";
    events.push({ key: `statePension:${person.id}`, taxYear: firstYear.taxYear, label: `State Pension starts${suffix}`, color: "#f08c00" });
  }

  // A SIPP specifically (not a workplace DC pension) starting to be drawn
  // from. `PersonYearResult.drawdownFromPension` is a per-person total
  // across every pension account they own, not broken out per-account —
  // if someone holds both a SIPP and a workplace DC pension, this is an
  // approximation (the first year *any* of their pensions pays out),
  // attributed here to the SIPP since that's what the user asked to see
  // marked.
  for (const account of scenario.accounts) {
    if (account.kind !== "pension" || account.pensionType !== "sipp") continue;
    const firstYear = result.rows.find((row) => row.perPerson.some((p) => p.personId === account.owner && p.drawdownFromPension > 0));
    if (!firstYear) continue;
    const suffix = people.length > 1 ? ` (${ownerLabel(account.owner, people)})` : "";
    events.push({ key: `sipp-start:${account.id}`, taxYear: firstYear.taxYear, label: `SIPP starts${suffix}`, color: "#1971c2" });
  }

  // The first year a pension/ISA/GIA/cash account's balance actually hits
  // zero, having held money at some point before that — a property's
  // equity isn't included, since a property runs out via its own "Sale"
  // event above, not by draining to nothing the same way a pot does.
  for (const account of scenario.accounts) {
    if (account.kind === "property") continue;
    let previousBalance: Pence | undefined;
    for (const row of result.rows) {
      const balance = row.accountBalances.get(account.id);
      if (balance === undefined) break;
      if (previousBalance !== undefined && previousBalance > 0 && balance <= 0) {
        events.push({ key: `depleted:${account.id}`, taxYear: row.taxYear, label: `${accountBaseLabel(account, people)} runs out`, color: "#e03131" });
        break;
      }
      previousBalance = balance;
    }
  }

  return events;
}

interface ShortfallRange {
  readonly start: string;
  readonly end: string;
}

/**
 * Consecutive tax years where a drawdown target isn't being fully met
 * (SPEC.md §5.7), merged into runs rather than one marker per year — a
 * five-year stretch of shortfall reads as one shaded band, not five
 * overlapping slivers. Household-level (any person's shortfall counts),
 * matching the existing "Key flags"/table ⚠ convention for the same
 * condition. Deliberately scoped to *drawdown* shortfall only, not the
 * related-but-distinct living-expenses shortfall (SPEC.md §5.1 step 7) —
 * the two are already visually distinguished elsewhere (the table's own
 * separate ⚠ columns), and conflating them here would blur what the
 * shading is actually telling you.
 */
function computeShortfallRanges(result: ProjectionResult): readonly ShortfallRange[] {
  const ranges: ShortfallRange[] = [];
  let start: string | null = null;
  let end: string | null = null;
  for (const row of result.rows) {
    const isShortfall = row.perPerson.some((p) => p.drawdownShortfall);
    if (isShortfall) {
      start ??= row.taxYear;
      end = row.taxYear;
    } else if (start !== null && end !== null) {
      ranges.push({ start, end });
      start = null;
      end = null;
    }
  }
  if (start !== null && end !== null) ranges.push({ start, end });
  return ranges;
}

function formatCurrencyTick(v: number): string {
  return `£${formatNumber(v)}`;
}

// The exact font both charts' Y-axis ticks render in (`CHART_TICK_STYLE`
// below) — kept as one shared constant so `measureTextWidth`'s canvas
// measurement can never quietly drift out of sync with what's actually
// on screen.
const CHART_TICK_FONT_SIZE = 12;
const CHART_TICK_FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji'";
const CHART_TICK_STYLE = { fontSize: CHART_TICK_FONT_SIZE };

let measurementCanvasContext: CanvasRenderingContext2D | null | undefined;

/**
 * The real, rendered pixel width of a tick label — a canvas measurement,
 * not an estimate. An earlier version of this guessed ~7px/character,
 * which was close enough to *look* right but not exact, so the two
 * charts' Y-axes (each computing their own "close enough" width off
 * different numbers) still didn't quite line up. Measuring the actual
 * font removes that whole class of error. The canvas/context itself is
 * memoised (cheap to reuse, wasteful to recreate per call); the
 * measurement result is not, since it depends on the text.
 */
function measureTextWidth(text: string): number {
  if (measurementCanvasContext === undefined) {
    measurementCanvasContext = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  if (!measurementCanvasContext) return text.length * 7; // non-browser fallback — never actually hit in this client-only app
  measurementCanvasContext.font = `${CHART_TICK_FONT_SIZE}px ${CHART_TICK_FONT_FAMILY}`;
  return measurementCanvasContext.measureText(text).width;
}

/**
 * A shared Y-axis width for both charts. Recharts' `YAxis width` is a
 * fixed pixel allocation, not an automatic fit — leaving each chart to
 * size its own axis off only *its own* values means the balances chart
 * (needing room for "£1,600,000") and the income chart (needing far
 * less, for "£40,000") end up with different-width axis gutters, so
 * their plot areas start at different X-offsets and visibly don't line
 * up. Computed once from the single longest formatted label across
 * *every* line on *both* charts, and applied to both, so their left
 * edges always match regardless of which one actually needs more room.
 */
function estimateSharedYAxisWidth(chartData: readonly Record<string, unknown>[], metricGroups: readonly (readonly ChartMetric[])[]): number {
  let maxAbs = 0;
  for (const metrics of metricGroups) {
    for (const row of chartData) {
      for (const m of metrics) {
        const value = Number(row[m.key]) || 0;
        maxAbs = Math.max(maxAbs, Math.abs(value));
      }
    }
  }
  const longestLabel = formatCurrencyTick(Math.round(maxAbs));
  return Math.max(60, Math.ceil(measureTextWidth(longestLabel)) + 24);
}

/**
 * One `<LineChart>`, reused for both the balances chart and the income
 * chart below it — same `chartData`/X-axis/events/shortfall shading, so
 * the two stay pixel-aligned and visually consistent, differing only in
 * which metrics (and therefore which Y-axis scale) they plot. Splitting
 * this out is what actually *guarantees* that alignment, rather than
 * hoping two hand-written, independently-edited chart blocks never drift
 * apart from each other.
 */
function ProjectionLineChart({
  chartData,
  visibleMetrics,
  axisMode,
  chartTextColor,
  chartGridColor,
  isDark,
  stackedChartEvents,
  shortfallRanges,
  axisValueByTaxYear,
  maxEventStackSize,
  emptyMessage,
  yAxisWidth,
}: {
  // Not `readonly` — recharts' own `LineChart` prop type wants a plain
  // mutable array; `chartData` is already a freshly-built one from
  // `.map()`, so nothing is actually at risk of being mutated here.
  readonly chartData: Record<string, unknown>[];
  readonly visibleMetrics: readonly ChartMetric[];
  readonly axisMode: RowAxisMode;
  readonly chartTextColor: string;
  readonly chartGridColor: string;
  readonly isDark: boolean;
  readonly stackedChartEvents: readonly (ChartEvent & { readonly stackIndex: number })[];
  readonly shortfallRanges: readonly ShortfallRange[];
  readonly axisValueByTaxYear: ReadonlyMap<string, string | number>;
  readonly maxEventStackSize: number;
  readonly emptyMessage: string;
  /** Shared across both charts (`estimateSharedYAxisWidth`) — see that function's own comment for why this can't just be each chart's own default. */
  readonly yAxisWidth: number;
}) {
  return (
    <div style={{ height: 300 }}>
      {visibleMetrics.length === 0 ? (
        <Center h="100%">
          <Text c="dimmed">{emptyMessage}</Text>
        </Center>
      ) : (
        <ResponsiveContainer width="100%" height="100%">
          {/* One more stacked "row" than the event labels alone need — reserved for the "Shortfall" label(s) below, which always sit one level above the tallest stack of event labels (never inside the plot area, where a "bottom" position previously got drawn over by the data line itself). */}
          <LineChart
            data={chartData}
            margin={{ top: 24 + (maxEventStackSize + (shortfallRanges.length > 0 ? 1 : 0) - 1) * 12, right: 20, bottom: 10, left: 10 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartGridColor} />
            {shortfallRanges.map((r) =>
              // A `ReferenceArea` with x1 === x2 (a single-year shortfall)
              // resolves to a zero-width rectangle on this category axis
              // and never renders at all — a real bug a user hit ("if net
              // income doesn't match the target for one year only, the
              // graph doesn't show this at all"). A `ReferenceLine` has no
              // width to collapse, so it stays visible regardless of how
              // many years the shortfall spans.
              // Labelled "Shortfall", pinned one stack level *above* the
              // tallest stack of event labels (`maxEventStackSize * 12`) —
              // a drawdown phase's own start/end events (pink, dashed)
              // very often land on this exact same year, since a
              // shortfall typically begins right when a phase starts, so
              // sharing the same level would overlap them; a bottom
              // position was tried first, but sits right where the data
              // line itself is drawn (both near the low end of the axis),
              // hiding the label behind the line.
              r.start === r.end ? (
                <ReferenceLine
                  key={`shortfall:${r.start}`}
                  x={axisValueByTaxYear.get(r.start) ?? r.start}
                  stroke="#e03131"
                  strokeWidth={3}
                  ifOverflow="extendDomain"
                  label={{ value: "Shortfall", position: "top", fill: "#e03131", fontSize: 10, offset: 8 + maxEventStackSize * 12 }}
                />
              ) : (
                <ReferenceArea
                  key={`shortfall:${r.start}`}
                  x1={axisValueByTaxYear.get(r.start) ?? r.start}
                  x2={axisValueByTaxYear.get(r.end) ?? r.end}
                  fill="#e03131"
                  fillOpacity={0.1}
                  ifOverflow="extendDomain"
                  label={{ value: "Shortfall", position: "top", fill: "#e03131", fontSize: 10, offset: 8 + maxEventStackSize * 12 }}
                />
              ),
            )}
            <XAxis
              dataKey="axisValue"
              type="category"
              tickFormatter={(v: string | number) => (axisMode === "taxYear" ? (String(v).split("-")[0] ?? String(v)) : String(v))}
              tick={{ fill: chartTextColor }}
              stroke={chartGridColor}
            />
            <YAxis
              width={yAxisWidth}
              tickFormatter={formatCurrencyTick}
              tick={{ fill: chartTextColor, ...CHART_TICK_STYLE }}
              stroke={chartGridColor}
            />
            <Tooltip
              formatter={(v: number) => formatMoneyRounded(v)}
              contentStyle={{ backgroundColor: isDark ? "#25262B" : "#fff", borderColor: chartGridColor, color: chartTextColor }}
            />
            <Legend wrapperStyle={{ color: chartTextColor }} />
            {visibleMetrics.map((m) => (
              // `isAnimationActive={false}` — Recharts otherwise animates
              // the line being drawn in over ~1.5s by default, which means
              // every edit (this component's `chartData` prop changing)
              // keeps re-rendering the chart on every animation frame for
              // that whole window, not just once. This showed up directly
              // in profiling as the largest contributor to "adding/
              // removing a card feels slow" — turning it off makes each
              // update a single, immediate redraw instead.
              <Line key={m.key} type="monotone" dataKey={m.key} name={m.label} stroke={m.color} strokeWidth={2} isAnimationActive={false} />
            ))}
            {stackedChartEvents.map((e) => (
              <ReferenceLine
                key={e.key}
                x={axisValueByTaxYear.get(e.taxYear) ?? e.taxYear}
                stroke={e.color}
                strokeDasharray="4 4"
                ifOverflow="extendDomain"
                label={{ value: e.label, position: "top", fill: e.color, fontSize: 10, offset: 8 + e.stackIndex * 12 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
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
  // A view preference, like `selectedMetrics` below — starts on "Tax
  // year" so the table and chart both match their existing look until
  // asked for something else.
  const [axisMode, setAxisMode] = useState<RowAxisMode>("taxYear");
  // "Their age" only makes sense with a second person — if one existed
  // when this was picked and was since removed (the "Plan for two
  // people" switch is a real, reachable toggle), fall back rather than
  // leaving the table/chart pointed at a person who's no longer there.
  useEffect(() => {
    if (axisMode === "otherAge" && (!scenario || scenario.household.people.length < 2)) {
      setAxisMode("taxYear");
    }
  }, [axisMode, scenario]);
  // A view preference, not part of the financial plan — kept out of the
  // Scenario itself, but persisted to localStorage (not just component
  // state) so a chosen set of lines survives a page reload rather than
  // resetting every time. Stale keys from a previous scenario's own
  // accounts/income sources (e.g. an account since deleted) are harmless:
  // `selectedVisibleMetrics` below only renders whichever of these keys
  // still exist in the current `allMetrics`. "Net worth" seeds the
  // balances chart the same way it always has; "Net income" seeds the
  // income chart below it so that one isn't an empty placeholder by
  // default either.
  const [selectedMetrics, setSelectedMetrics] = useLocalStorage<string[]>({
    key: "canistop:selected-chart-lines",
    defaultValue: ["netWorth", "netIncome"],
  });

  const result = useMemo(() => (scenario ? computeProjection(scenario) : null), [scenario]);
  const keyFlags = useMemo(() => computeKeyFlags(result, scenario), [result, scenario]);
  const chartEvents = useMemo(() => (scenario && result ? buildChartEvents(scenario, result) : []), [scenario, result]);
  // Two or more events can land on the same tax year (e.g. "Drawdown
  // starts" and "SIPP starts" both firing the moment decumulation
  // begins), or on years merely close together (e.g. two people's State
  // Pension starting a year apart) — a label like "State Pension starts
  // (Partner)" is far wider than the horizontal gap between two adjacent
  // tax-year ticks, so even distinct years' labels can visually collide.
  // Stack any labels within `collisionWindow` tax years of each other at
  // increasing heights instead (a greedy interval-colouring pass, sorted
  // chronologically — the same idea as the old same-year-only version,
  // generalised from "exact match" to "close enough"), and grow the
  // chart's top margin to fit however tall the tallest stack turns out to
  // be. The window widens as the projection covers more years, since more
  // years packed into the same chart width means less room between ticks.
  const stackedChartEvents = useMemo(() => {
    if (!result) return [];
    const rowIndexByTaxYear = new Map(result.rows.map((row, i) => [row.taxYear, i]));
    const collisionWindow = Math.max(2, Math.ceil(result.rows.length / 10));
    const sorted = [...chartEvents].sort(
      (a, b) => (rowIndexByTaxYear.get(a.taxYear) ?? 0) - (rowIndexByTaxYear.get(b.taxYear) ?? 0),
    );
    const placed: { readonly rowIndex: number; readonly stackIndex: number }[] = [];
    const stackIndexByKey = new Map<string, number>();
    for (const event of sorted) {
      const rowIndex = rowIndexByTaxYear.get(event.taxYear) ?? 0;
      const usedLevels = new Set(placed.filter((p) => Math.abs(p.rowIndex - rowIndex) < collisionWindow).map((p) => p.stackIndex));
      let stackIndex = 0;
      while (usedLevels.has(stackIndex)) stackIndex++;
      placed.push({ rowIndex, stackIndex });
      stackIndexByKey.set(event.key, stackIndex);
    }
    return chartEvents.map((e) => ({ ...e, stackIndex: stackIndexByKey.get(e.key) ?? 0 }));
  }, [chartEvents, result]);
  const maxEventStackSize = useMemo(
    () => stackedChartEvents.reduce((max, e) => Math.max(max, e.stackIndex + 1), 0),
    [stackedChartEvents],
  );
  const shortfallRanges = useMemo(() => (result ? computeShortfallRanges(result) : []), [result]);
  // Deliberately *not* `shortfallRanges.length > 0` — that's scoped to
  // drawdown shortfalls only (see its own doc comment), but a Living
  // Expenses shortfall on its own (no drawdown target at all) is exactly
  // one of the cases `computeShortfallGaps` below has something useful to
  // say about (that a pension alone can't fix it).
  const hasAnyShortfall = useMemo(
    () => (result ? result.rows.some((row) => row.perPerson.some((p) => p.drawdownShortfall || p.livingExpensesShortfall)) : false),
    [result],
  );
  // `computeShortfallGaps` re-runs the whole engine dozens of times (a
  // black-box binary search per account kind) — cheap once, but this page
  // recomputes `scenario` on every keystroke, and running an expensive
  // search synchronously on every single one would make typing feel
  // laggy. Debounced into its own effect instead (the same pattern
  // `persistence/autosave.ts` already uses for IndexedDB writes), so
  // editing stays instant and this only recomputes once things settle.
  const [shortfallGaps, setShortfallGaps] = useState<readonly ShortfallGap[]>([]);
  useEffect(() => {
    if (!scenario || !hasAnyShortfall) {
      setShortfallGaps([]);
      return;
    }
    const timeout = setTimeout(() => setShortfallGaps(computeShortfallGaps(scenario)), 500);
    return () => clearTimeout(timeout);
  }, [scenario, hasAnyShortfall]);
  const accountMetrics = useMemo(() => (scenario ? buildAccountMetrics(scenario) : []), [scenario]);
  const incomeSourceMetrics = useMemo(() => (scenario ? buildIncomeSourceMetrics(scenario) : []), [scenario]);
  const allMetrics = useMemo(
    () => [...CHART_METRICS, ...accountMetrics, ...incomeSourceMetrics],
    [accountMetrics, incomeSourceMetrics],
  );
  const balanceMetrics = useMemo(
    () => accountMetrics.filter((m) => m.accountKind === "pension" || m.accountKind === "isa" || m.accountKind === "gia" || m.accountKind === "cash"),
    [accountMetrics],
  );
  // Split the same way the taxable/non-taxable drawdown preference does
  // (`drawdown/solveDrawdown.ts`'s `taxablePreferenceAmount`): pension is
  // the one taxable account kind, ISA/GIA/cash the non-taxable ones — so
  // a balance column reuses the exact same colour as the income columns
  // it corresponds to, rather than a third, unrelated colour scheme.
  const pensionBalanceMetrics = useMemo(() => balanceMetrics.filter((m) => m.accountKind === "pension"), [balanceMetrics]);
  const nonTaxableBalanceMetrics = useMemo(() => balanceMetrics.filter((m) => m.accountKind !== "pension"), [balanceMetrics]);
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

  // "axisValue" carries whatever the X-axis is currently keyed on (the tax
  // year string, or a person's age that year) — a separate field from
  // `taxYear`, which stays around unconditionally so events and shortfall
  // bands (both only ever known by tax year) can still be looked up and
  // translated onto whichever axis is currently showing.
  //
  // Memoized (and so hoisted above the early return below, per the Rules
  // of Hooks) rather than plain consts recomputed on every render — this
  // used to redo `allMetrics.map()` per table row (calling every metric's
  // own `compute` closure) and a canvas `measureText` call on every single
  // render of this component, including ones triggered by something this
  // data doesn't even depend on (e.g. a dark-mode toggle, or any sidebar
  // edit at all, since `ProjectionResults` re-renders whenever its parent
  // does). That showed up directly in profiling as the dominant cost
  // behind "adding/removing a card feels slow."
  const people = scenario?.household.people ?? [];
  const axisPerson = personForRowAxisMode(axisMode, people);
  const chartData = useMemo(
    () =>
      result
        ? result.rows.map((row) => ({
            taxYear: row.taxYear,
            axisValue: axisPerson ? ageAtYear(axisPerson.dateOfBirth, row.calendarYear) : row.taxYear,
            ...Object.fromEntries(allMetrics.map((m) => [m.key, m.compute(row)])),
          }))
        : [],
    [result, allMetrics, axisPerson],
  );
  const axisValueByTaxYear = useMemo(() => new Map(chartData.map((d) => [d.taxYear, d.axisValue])), [chartData]);
  const selectedVisibleMetrics = useMemo(() => allMetrics.filter((m) => selectedMetrics.includes(m.key)), [allMetrics, selectedMetrics]);
  const visibleBalanceMetrics = useMemo(() => selectedVisibleMetrics.filter((m) => m.scale === "balance"), [selectedVisibleMetrics]);
  const visibleFlowMetrics = useMemo(() => selectedVisibleMetrics.filter((m) => m.scale === "flow"), [selectedVisibleMetrics]);
  const sharedYAxisWidth = useMemo(
    () => estimateSharedYAxisWidth(chartData, [visibleBalanceMetrics, visibleFlowMetrics]),
    [chartData, visibleBalanceMetrics, visibleFlowMetrics],
  );

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
          <Button variant="subtle" onClick={() => void navigate("/stress-test")}>
            Stress test
          </Button>
        </Group>
      </Group>

      <Alert color="blue" variant="light">
        Illustrative projection only, not financial advice — figures are in today&rsquo;s money.
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
          ...(incomeSourceMetrics.length > 0
            ? [{ group: "Income sources", items: incomeSourceMetrics.map((m) => ({ value: m.key, label: m.label })) }]
            : []),
        ]}
        value={selectedMetrics}
        onChange={setSelectedMetrics}
      />

      {(chartEvents.length > 0 || shortfallRanges.length > 0) && (
        <Text size="xs" c="dimmed">
          {chartEvents.length > 0 && "Dashed lines mark one-off events and when income sources or drawdown targets change. "}
          {shortfallRanges.length > 0 &&
            "Shaded red bands (or a solid red line, for a single year) mark when a drawdown target isn't fully met."}
        </Text>
      )}

      <Stack gap="xs">
        <Text size="sm" fw={600}>
          Account Balances
        </Text>
        <ProjectionLineChart
          chartData={chartData}
          visibleMetrics={visibleBalanceMetrics}
          axisMode={axisMode}
          chartTextColor={chartTextColor}
          chartGridColor={chartGridColor}
          isDark={isDark}
          stackedChartEvents={stackedChartEvents}
          shortfallRanges={shortfallRanges}
          axisValueByTaxYear={axisValueByTaxYear}
          maxEventStackSize={maxEventStackSize}
          emptyMessage="Select at least one line above to show a chart."
          yAxisWidth={sharedYAxisWidth}
        />

        <Text size="sm" fw={600}>
          Income
        </Text>
        <ProjectionLineChart
          chartData={chartData}
          visibleMetrics={visibleFlowMetrics}
          axisMode={axisMode}
          chartTextColor={chartTextColor}
          chartGridColor={chartGridColor}
          isDark={isDark}
          stackedChartEvents={stackedChartEvents}
          shortfallRanges={shortfallRanges}
          axisValueByTaxYear={axisValueByTaxYear}
          maxEventStackSize={maxEventStackSize}
          emptyMessage="Select an income or tax line above to show this chart."
          yAxisWidth={sharedYAxisWidth}
        />
      </Stack>

      {shortfallGaps.length > 0 && (
        <Alert
          color="red"
          variant="light"
          title={
            <Group gap={4}>
              <Text size="sm" fw={600} c="inherit">
                Balances needed to avoid a shortfall
              </Text>
              <InfoTip>
                Each line is independent — &ldquo;£X more in your ISA&rdquo; means that alone, on top of everything
                else already in the plan unchanged, not stacked with the other lines. Added once, today, to your
                existing account of that kind (or a new one with this app&rsquo;s usual default assumptions, if you
                don&rsquo;t have one yet).
              </InfoTip>
            </Group>
          }
        >
          <Stack gap={4}>
            {shortfallGaps.map((gap) => (
              <Text key={gap.kind} size="sm">
                {gap.extraNeeded !== undefined
                  ? `${formatMoneyRounded(penceToPounds(gap.extraNeeded))} more in your ${GAP_ACCOUNT_KIND_LABELS[gap.kind]} would have avoided every shortfall in this plan.`
                  : `Extra ${GAP_ACCOUNT_KIND_LABELS[gap.kind]} savings alone wouldn't have helped — ${gap.unfixableReason}.`}
              </Text>
            ))}
          </Stack>
        </Alert>
      )}

      <Group justify="space-between">
        <Group gap={4}>
          <Title order={4}>Year by year</Title>
          <InfoTip>
            Account balances on the left, then how much went into each one this year under
            &ldquo;Contributions&rdquo; (money from outside the plan, not a reduction to your net income), then
            &ldquo;Outgoings&rdquo; — just expenses — then everything that came in this year under
            &ldquo;Income&rdquo; — taxable sources in teal, non-taxable in cyan, matching the balance columns.
            Pension withdrawals split into their own tax-free and taxable shares, with the drawdown net total, then
            &ldquo;Income Over Target&rdquo; (lime — income beyond what a drawdown target already treats as spent),
            then combined net income (yellow) after both tax and expenses, at the far right of that section. Then
            tax and net worth. The &ldquo;Show&rdquo; dropdown also sets what the graph above is plotted against.
          </InfoTip>
        </Group>
        <Select
          label="Show"
          data={rowAxisModeOptions(people)}
          value={axisMode}
          onChange={(v) => setAxisMode(v === "myAge" || v === "otherAge" ? v : "taxYear")}
          allowDeselect={false}
          w={160}
        />
      </Group>
      <Text c="dimmed" size="xs">
        Figures are estimates from a personal project and may be wrong — don&rsquo;t rely on them as your only source
        for real financial decisions.
      </Text>
      {/* Bounded height (not just `overflowX: auto`) so both scrollbars stay reachable near the top of this section — with 20+ rows, a plain full-height table pushes its own horizontal scrollbar to the very bottom of the page, forcing a scroll-down-then-right dance just to see the rest of a row. The header is pinned (`position: sticky`) so scrolling within this box doesn't lose track of which column is which. */}
      <div style={{ overflow: "auto", maxHeight: "70vh" }}>
        <Table
          striped
          withTableBorder
          withColumnBorders
          style={{ tableLayout: "fixed" }}
          ff="monospace"
          miw={TABLE_COLUMN_WIDTH * (1 + visibleColumnGroups.reduce((n, g) => n + g.columns.length, 0) + 1 + balanceMetrics.length)}
        >
          {/* Mantine's "-light" tokens (used for every coloured header cell below) are translucent tints, not solid fills — fine for a static header, but with `position: sticky` they'd let scrolled-past body rows show through. An opaque base on `Thead` itself sits behind them so the header reads as solid while it's pinned. */}
          <Table.Thead bg="var(--mantine-color-body)" style={{ position: "sticky", top: 0, zIndex: 1 }}>
            <Table.Tr>
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2}>
                {rowAxisColumnLabel(axisMode, people)}
              </Table.Th>
              {pensionBalanceMetrics.length > 0 && (
                <Table.Th colSpan={pensionBalanceMetrics.length} bg="var(--mantine-color-teal-light)" ta="center">
                  Pension balances
                </Table.Th>
              )}
              {nonTaxableBalanceMetrics.length > 0 && (
                <Table.Th colSpan={nonTaxableBalanceMetrics.length} bg="var(--mantine-color-cyan-light)" ta="center">
                  Non-taxable balances
                </Table.Th>
              )}
              {visibleColumnGroups.map((group) => (
                <Table.Th key={group.label} colSpan={group.columns.length} bg={group.bg} ta="center">
                  {group.label}
                </Table.Th>
              ))}
              <Table.Th w={TABLE_COLUMN_WIDTH} rowSpan={2} bg="var(--mantine-color-blue-light)">
                Net worth
              </Table.Th>
            </Table.Tr>
            <Table.Tr>
              {pensionBalanceMetrics.map((m) => (
                <Table.Th key={m.key} w={TABLE_COLUMN_WIDTH} bg="var(--mantine-color-teal-light)">
                  {m.label}
                </Table.Th>
              ))}
              {nonTaxableBalanceMetrics.map((m) => (
                <Table.Th key={m.key} w={TABLE_COLUMN_WIDTH} bg="var(--mantine-color-cyan-light)">
                  {m.label}
                </Table.Th>
              ))}
              {visibleColumnGroups.flatMap((group) =>
                group.columns.map((column) => (
                  <Table.Th key={column.key} w={TABLE_COLUMN_WIDTH} bg={column.bg ?? group.bg}>
                    {column.label}
                  </Table.Th>
                )),
              )}
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {result.rows.map((row) => {
              const netWorth = computeNetWorth(row);
              return (
                <Table.Tr key={row.taxYear}>
                  <Table.Td>{rowAxisLabel(row, axisMode, people)}</Table.Td>
                  {pensionBalanceMetrics.map((m) => (
                    <Table.Td key={m.key} bg="var(--mantine-color-teal-light)" ta="right">
                      {formatPoundsMoney(m.compute(row))}
                    </Table.Td>
                  ))}
                  {nonTaxableBalanceMetrics.map((m) => (
                    <Table.Td key={m.key} bg="var(--mantine-color-cyan-light)" ta="right">
                      {formatPoundsMoney(m.compute(row))}
                    </Table.Td>
                  ))}
                  {visibleColumnGroups.flatMap((group) =>
                    group.columns.map((column) => (
                      <Table.Td key={column.key} bg={column.bg ?? group.bg} ta="right">
                        {formatMoney(column.compute(row))}
                        {column.warningFlag?.(row) ? " ⚠" : ""}
                      </Table.Td>
                    )),
                  )}
                  <Table.Td bg="var(--mantine-color-blue-light)" fw={600} ta="right">
                    {formatMoney(netWorth)}
                  </Table.Td>
                </Table.Tr>
              );
            })}
          </Table.Tbody>
        </Table>
      </div>
    </Stack>
  );
}
