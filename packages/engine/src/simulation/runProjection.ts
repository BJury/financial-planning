/**
 * This loop calls registered catalog definitions' `isActive`/
 * `calculateForYear` with their config resolved from an erased-`any`
 * boundary (`resolveConfig` below), the same deliberate, documented
 * erasure `catalog/registry.ts` already uses — correctness here is
 * guaranteed by construction (a catalog item's `type` string always
 * matches the shape its own module wrote it with, §3.11), not statically
 * provable at this composition point. Disabled file-wide rather than
 * with dozens of scattered inline comments, since every future phase
 * adds more catalog types to this same loop.
 */
/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
import { addPence, sumPence, subtractPence, zeroPence, growPenceByRate, type Pence } from "../money/pence.js";
import { registry } from "../catalog/registry.js";
import type { ScenarioState, YearContext } from "../catalog/types.js";
import { prepareRuleSetForScenario } from "../realTerms/prepareRuleSetForScenario.js";
import { applyIncomeTaxBands, buildFullBandStack, taperPersonalAllowance } from "../tax/incomeTax.js";
import { calculateNI } from "../tax/nationalInsurance.js";
import { extendBandsForReliefAtSource, grossUpAtBasicRate } from "../tax/pensionRelief/reliefAtSource.js";
import type { PensionContributionConfig } from "../catalog/incomeDrains/pensionContribution.js";
import type { IsaContributionConfig } from "../catalog/incomeDrains/isaContribution.js";
import type { PersonId, Scenario } from "../schema/types.js";
import type { TaxYearRuleSet } from "../taxYearData/types.js";

/**
 * A catalog item's `type` string is what actually guarantees its
 * `config` matches the registered definition's expected shape —
 * verified by construction (the UI only ever writes a `config` using
 * that same type's field schema, §3.11), not by the type checker at this
 * composition boundary. This mirrors the registry's own documented,
 * contained type erasure (catalog/registry.ts) rather than being a new
 * escape hatch.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function resolveConfig(config: unknown): any {
  return config;
}

export interface PersonYearResult {
  readonly personId: PersonId;
  readonly grossIncome: Pence;
  readonly grossPensionContribution: Pence;
  readonly incomeTax: Pence;
  readonly nationalInsurance: Pence;
  readonly netIncome: Pence;
}

export interface YearLedgerRow {
  readonly taxYear: string;
  readonly calendarYear: number;
  readonly perPerson: readonly PersonYearResult[];
  readonly accountBalances: ReadonlyMap<string, Pence>;
}

export interface ProjectionResult {
  readonly rows: readonly YearLedgerRow[];
}

/**
 * The year-by-year simulation loop (SPEC.md §5.1) — Phase 1 subset only:
 * a single accumulation-phase pass per person (no Marriage Allowance, no
 * drawdown solver, no rental/property/GIA income yet). Deliberately kept
 * as a thin composition of the small pure functions built elsewhere in
 * this package — this function itself must never grow into a "compute
 * the whole year" block (SPEC.md §9.3's core review heuristic).
 */
export function runProjection(scenario: Scenario, confirmedRuleSet: TaxYearRuleSet, numberOfYears: number): ProjectionResult {
  const rows: YearLedgerRow[] = [];
  const confirmedCalendarYear = Number.parseInt(confirmedRuleSet.taxYear.split("-")[0] ?? "0", 10);

  let accountBalances = new Map<string, Pence>(scenario.accounts.map((account) => [account.id, account.currentBalance]));

  for (let yearIndex = 0; yearIndex < numberOfYears; yearIndex++) {
    const calendarYear = confirmedCalendarYear + yearIndex;
    const taxYear = `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
    const yearContext: YearContext = { taxYear, calendarYear, yearIndex };
    const state: ScenarioState = { scenario, accountBalances };

    const prepared = prepareRuleSetForScenario(confirmedRuleSet, scenario.upratingPolicy, scenario.inflationRate, yearIndex);
    const nextAccountBalances = new Map(accountBalances);
    const perPerson: PersonYearResult[] = [];

    for (const person of scenario.household.people) {
      // 1. Sum this person's active earned-income sources (Phase 1: Salary only).
      let grossIncome = zeroPence();
      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = resolveConfig(source.config);
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;
        const result = definition.calculateForYear(config, state, yearContext, source.owner);
        if (result.kind === "simple" && result.taxCategory === "earnedIncome") {
          grossIncome = addPence(grossIncome, result.amount);
        }
        // Other tax categories (pensionIncome, rentalProfit, etc.) are added in later phases.
      }

      // 2. Sum this person's active drains, applying each one's own effect: a
      //    relief-at-source pension contribution is grossed up into its
      //    account and extends the tax bands; an ISA contribution is credited
      //    to its account with no tax effect.
      let grossPensionContribution = zeroPence();
      for (const drain of scenario.incomeDrains) {
        if (drain.owner !== person.id) continue;
        const definition = registry.getIncomeDrain(drain.type);
        const config = resolveConfig(drain.config);
        if (!definition.isActive(config, state, yearContext, drain.owner)) continue;
        const drainResult = definition.calculateForYear(config, state, yearContext, drain.owner);

        if (drainResult.taxTreatment === "reliefAtSourceBasicRateTopUp") {
          const basicRate = prepared.incomeTaxBands.find((b) => b.name === "basic")?.rate ?? 0;
          const grossedUp = grossUpAtBasicRate(drainResult.amount, basicRate);
          grossPensionContribution = addPence(grossPensionContribution, grossedUp);

          const { pensionAccountId } = drain.config as PensionContributionConfig;
          const currentBalance = nextAccountBalances.get(pensionAccountId) ?? zeroPence();
          nextAccountBalances.set(pensionAccountId, addPence(currentBalance, grossedUp));
        } else if (drainResult.taxTreatment === "none" && drain.type === "isaContribution") {
          const { isaAccountId } = drain.config as IsaContributionConfig;
          const currentBalance = nextAccountBalances.get(isaAccountId) ?? zeroPence();
          nextAccountBalances.set(isaAccountId, addPence(currentBalance, drainResult.amount));
        }
      }

      // 3. Income Tax: relief-at-source extends the basic/higher band
      //    ceilings by the gross contribution; the Personal Allowance
      //    taper uses adjusted net income (gross income less gross
      //    pension contributions).
      const extendedBands = extendBandsForReliefAtSource(prepared.incomeTaxBands, grossPensionContribution);
      const adjustedNetIncome = subtractPence(grossIncome, grossPensionContribution);
      const taperedAllowance = taperPersonalAllowance(
        adjustedNetIncome,
        prepared.personalAllowance,
        prepared.personalAllowanceTaperThreshold,
        prepared.personalAllowanceTaperRate,
      );
      const fullBands = buildFullBandStack(taperedAllowance, extendedBands);
      const incomeTax = applyIncomeTaxBands(grossIncome, fullBands);

      // 4. National Insurance — independent of Income Tax (SPEC.md §5.3, §9.3).
      const nationalInsurance = calculateNI(grossIncome, prepared.nationalInsurance);

      const netIncome = subtractPence(subtractPence(grossIncome, incomeTax), nationalInsurance);

      perPerson.push({
        personId: person.id,
        grossIncome,
        grossPensionContribution,
        incomeTax,
        nationalInsurance,
        netIncome,
      });
    }

    // 5. Grow every account balance by its own (already-real) growth rate,
    //    net of any pension charge, after this year's contributions have
    //    already been credited above.
    for (const account of scenario.accounts) {
      const balance = nextAccountBalances.get(account.id) ?? zeroPence();
      const netGrowthRate = account.kind === "pension" ? account.annualGrowthRate - account.annualChargeRate : account.annualGrowthRate;
      nextAccountBalances.set(account.id, growPenceByRate(balance, netGrowthRate));
    }

    accountBalances = nextAccountBalances;
    rows.push({ taxYear, calendarYear, perPerson, accountBalances: new Map(accountBalances) });
  }

  return { rows };
}

/** Total tax (Income Tax + NI) across every person, for a given year's ledger row — a small convenience used by golden-file tests and (later) the tax breakdown view. */
export function totalTaxForYear(row: YearLedgerRow): Pence {
  return sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.nationalInsurance]));
}
