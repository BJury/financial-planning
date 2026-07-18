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
import { isWithinActiveDateRange } from "../schema/activeDateRange.js";
import { prepareRuleSetForScenario } from "../realTerms/prepareRuleSetForScenario.js";
import { applyIncomeTaxBands, buildFullBandStack, computeRemainingBandHeadroom, taperPersonalAllowance } from "../tax/incomeTax.js";
import { calculateNI } from "../tax/nationalInsurance.js";
import { extendBandsForReliefAtSource, grossUpAtBasicRate } from "../tax/pensionRelief/reliefAtSource.js";
import { applyNetPayRelief } from "../tax/pensionRelief/netPay.js";
import { applySalarySacrifice } from "../tax/pensionRelief/salarySacrifice.js";
import { taperAnnualAllowance } from "../tax/pensionRelief/annualAllowanceTaper.js";
import {
  applyAnnualAllowanceCarryForward,
  emptyCarryForwardWindow,
} from "../tax/pensionRelief/annualAllowanceCarryForward.js";
import { calculateAnnualAllowanceCharge } from "../tax/pensionRelief/annualAllowanceCharge.js";
import { calculateThresholdAndAdjustedIncome } from "../tax/pensionRelief/annualAllowanceIncome.js";
import { solveDrawdown } from "../drawdown/solveDrawdown.js";
import type { PensionContributionConfig } from "../catalog/incomeDrains/pensionContribution.js";
import type { IsaContributionConfig } from "../catalog/incomeDrains/isaContribution.js";
import type { TargetDrawdownIncomeConfig } from "../catalog/incomeSources/targetDrawdownIncome.js";
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
  /** The relief-at-source contribution, grossed up at basic rate — this is the amount that extends the basic/higher band ceilings. */
  readonly grossPensionContribution: Pence;
  /** Every pension contribution for the year, gross, from every source and relief method, plus employer contributions — the Annual Allowance test figure. */
  readonly pensionInputAmount: Pence;
  readonly annualAllowanceCharge: Pence;
  readonly incomeTax: Pence;
  readonly nationalInsurance: Pence;
  /** Total gross withdrawn this year to fund any active drawdown target(s) — pension + ISA combined (SPEC.md §5.7). */
  readonly drawdownGrossWithdrawn: Pence;
  readonly drawdownIncomeTax: Pence;
  /** How much of the drawdown target(s) was actually achieved — may fall short of the target if balances ran out. */
  readonly drawdownNetAchieved: Pence;
  readonly drawdownShortfall: boolean;
  /** Earned-income net plus any drawdown net achieved — the person's total spendable cash for the year. */
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
 * The year-by-year simulation loop (SPEC.md §5.1) — Phase 1/2 subset:
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
  // Each person's rolling 3-year Annual Allowance carry-forward window
  // (oldest-first) — genuine simulated history, since a Scenario carries
  // no data from before the projection starts (SPEC.md §5.4).
  let carryForwardWindows = new Map<PersonId, readonly Pence[]>();
  // Each person's cumulative Lump Sum Allowance used to date, across every
  // pension pot for the whole plan — never resets, never assessed
  // pot-by-pot (SPEC.md §5.4, §5.7.2).
  let lumpSumAllowanceUsed = new Map<PersonId, Pence>();

  for (let yearIndex = 0; yearIndex < numberOfYears; yearIndex++) {
    const calendarYear = confirmedCalendarYear + yearIndex;
    const taxYear = `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
    const yearContext: YearContext = { taxYear, calendarYear, yearIndex };
    const state: ScenarioState = { scenario, accountBalances };

    const prepared = prepareRuleSetForScenario(confirmedRuleSet, scenario.upratingPolicy, scenario.inflationRate, yearIndex);
    const nextAccountBalances = new Map(accountBalances);
    const nextCarryForwardWindows = new Map(carryForwardWindows);
    const nextLumpSumAllowanceUsed = new Map(lumpSumAllowanceUsed);
    const perPerson: PersonYearResult[] = [];

    for (const person of scenario.household.people) {
      // 1. Sum this person's active earned-income sources (Phase 1: Salary only).
      let grossIncome = zeroPence();
      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id) continue;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = resolveConfig(source.config);
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;
        const result = definition.calculateForYear(config, state, yearContext, source.owner);
        if (result.kind === "simple" && result.taxCategory === "earnedIncome") {
          grossIncome = addPence(grossIncome, result.amount);
        }
        // Other tax categories (pensionIncome, rentalProfit, etc.) are added in later phases.
      }

      // 2. Sum this person's active pension/ISA drains, applying each
      //    relief method's own effect (SPEC.md §5.4): relief-at-source is
      //    grossed up into its account and extends the tax bands; net pay
      //    and salary sacrifice are deducted from gross pay before tax
      //    (and, for salary sacrifice, before NI too) and credited to the
      //    account at face value; an ISA contribution has no tax effect.
      let grossPensionContribution = zeroPence(); // relief-at-source only — extends the band ceilings
      let taxableIncomeReduction = zeroPence(); // net pay + salary sacrifice
      let salarySacrificeAmount = zeroPence(); // salary sacrifice only — also reduces NIable income
      let pensionInputAmount = zeroPence(); // every method's gross contribution, plus employer contributions below — the Annual Allowance figure

      for (const drain of scenario.incomeDrains) {
        if (drain.owner !== person.id) continue;
        if (!isWithinActiveDateRange(drain.startDate, drain.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeDrain(drain.type);
        const config = resolveConfig(drain.config);
        if (!definition.isActive(config, state, yearContext, drain.owner)) continue;
        const drainResult = definition.calculateForYear(config, state, yearContext, drain.owner);

        if (drainResult.taxTreatment === "reliefAtSourceBasicRateTopUp") {
          const basicRate = prepared.incomeTaxBands.find((b) => b.name === "basic")?.rate ?? 0;
          const grossedUp = grossUpAtBasicRate(drainResult.amount, basicRate);
          grossPensionContribution = addPence(grossPensionContribution, grossedUp);
          pensionInputAmount = addPence(pensionInputAmount, grossedUp);

          const { pensionAccountId } = drain.config as PensionContributionConfig;
          const currentBalance = nextAccountBalances.get(pensionAccountId) ?? zeroPence();
          nextAccountBalances.set(pensionAccountId, addPence(currentBalance, grossedUp));
        } else if (drainResult.taxTreatment === "reducesTaxableIncomeNetPay") {
          taxableIncomeReduction = addPence(taxableIncomeReduction, drainResult.amount);
          pensionInputAmount = addPence(pensionInputAmount, drainResult.amount);

          const { pensionAccountId } = drain.config as PensionContributionConfig;
          const currentBalance = nextAccountBalances.get(pensionAccountId) ?? zeroPence();
          nextAccountBalances.set(pensionAccountId, addPence(currentBalance, drainResult.amount));
        } else if (drainResult.taxTreatment === "reducesTaxableIncomeAndNISalarySacrifice") {
          taxableIncomeReduction = addPence(taxableIncomeReduction, drainResult.amount);
          salarySacrificeAmount = addPence(salarySacrificeAmount, drainResult.amount);
          pensionInputAmount = addPence(pensionInputAmount, drainResult.amount);

          const { pensionAccountId } = drain.config as PensionContributionConfig;
          const currentBalance = nextAccountBalances.get(pensionAccountId) ?? zeroPence();
          nextAccountBalances.set(pensionAccountId, addPence(currentBalance, drainResult.amount));
        } else if (drain.type === "isaContribution") {
          const { isaAccountId } = drain.config as IsaContributionConfig;
          const currentBalance = nextAccountBalances.get(isaAccountId) ?? zeroPence();
          nextAccountBalances.set(isaAccountId, addPence(currentBalance, drainResult.amount));
        }
      }

      // 2b. Employer pension contributions: a flat annual amount credited
      //     directly to the account, never taxed as the employee's income,
      //     but counted toward their Annual Allowance (SPEC.md §3.4, §5.4).
      for (const account of scenario.accounts) {
        if (account.kind !== "pension" || account.owner !== person.id) continue;
        pensionInputAmount = addPence(pensionInputAmount, account.employerAnnualContribution);
        const currentBalance = nextAccountBalances.get(account.id) ?? zeroPence();
        nextAccountBalances.set(account.id, addPence(currentBalance, account.employerAnnualContribution));
      }

      // 3. Income Tax: net pay/salary sacrifice reduce taxable income
      //    directly; relief-at-source extends the basic/higher band
      //    ceilings instead and separately reduces adjusted net income for
      //    the Personal Allowance taper (SPEC.md §5.4).
      const taxableIncome = applyNetPayRelief(grossIncome, taxableIncomeReduction);
      const extendedBands = extendBandsForReliefAtSource(prepared.incomeTaxBands, grossPensionContribution);
      const adjustedNetIncomeForPersonalAllowance = subtractPence(taxableIncome, grossPensionContribution);
      const taperedAllowance = taperPersonalAllowance(
        adjustedNetIncomeForPersonalAllowance,
        prepared.personalAllowance,
        prepared.personalAllowanceTaperThreshold,
        prepared.personalAllowanceTaperRate,
      );
      const fullBands = buildFullBandStack(taperedAllowance, extendedBands);
      const incomeTax = applyIncomeTaxBands(taxableIncome, fullBands);

      // 4. National Insurance — independent of Income Tax (SPEC.md §5.3,
      //    §9.3); only salary sacrifice reduces NIable pay.
      const niableIncome = applySalarySacrifice(grossIncome, salarySacrificeAmount);
      const nationalInsurance = calculateNI(niableIncome, prepared.nationalInsurance);

      // 5. Annual Allowance: taper this person's allowance by their
      //    threshold/adjusted income, consume this year's (then any
      //    carried-forward) allowance, and charge any true excess at
      //    their marginal rate (SPEC.md §5.4).
      const { thresholdIncome, adjustedIncome } = calculateThresholdAndAdjustedIncome({
        taxableIncomeAfterPensionDeductions: taxableIncome,
        salarySacrificeAmount,
        totalPensionInputAmount: pensionInputAmount,
      });
      const taperedAnnualAllowance = taperAnnualAllowance({
        thresholdIncome,
        adjustedIncome,
        standardAllowance: prepared.pensions.annualAllowance,
        taperThresholdIncome: prepared.pensions.taperThresholdIncome,
        taperThresholdAdjustedIncome: prepared.pensions.taperThresholdAdjustedIncome,
        taperMinimumAllowance: prepared.pensions.taperMinimumAllowance,
      });
      const carryForwardResult = applyAnnualAllowanceCarryForward({
        totalContribution: pensionInputAmount,
        currentYearAllowance: taperedAnnualAllowance,
        unusedAllowanceByPreviousThreeYears: carryForwardWindows.get(person.id) ?? emptyCarryForwardWindow(),
      });
      nextCarryForwardWindows.set(person.id, carryForwardResult.nextUnusedAllowanceByPreviousThreeYears);
      const annualAllowanceCharge = calculateAnnualAllowanceCharge(taxableIncome, carryForwardResult.excessContribution, fullBands);

      // 6. Drawdown (SPEC.md §5.7): source any active drawdown target(s)
      //    from this person's pension/ISA at the lowest tax cost, given
      //    whatever band headroom their earned income above has left this
      //    year. A dedicated pass rather than the generic loop in step 1,
      //    because — unlike every other catalog type — this one needs tax
      //    bands and account balances the generic `calculateForYear`
      //    signature doesn't expose (see targetDrawdownIncome.ts).
      let drawdownGrossWithdrawn = zeroPence();
      let drawdownIncomeTax = zeroPence();
      let drawdownNetAchieved = zeroPence();
      let drawdownShortfall = false;
      let taxableIncomeSoFarForBands = taxableIncome;

      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id || source.type !== "targetDrawdownIncome") continue;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = source.config as TargetDrawdownIncomeConfig;
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;

        const bandHeadroom = computeRemainingBandHeadroom(fullBands, taxableIncomeSoFarForBands);
        const pensionBalance = config.pensionAccountId ? (nextAccountBalances.get(config.pensionAccountId) ?? zeroPence()) : zeroPence();
        const isaBalance = config.isaAccountId ? (nextAccountBalances.get(config.isaAccountId) ?? zeroPence()) : zeroPence();
        const lumpSumAllowanceRemaining = subtractPence(
          prepared.pensions.lumpSumAllowance,
          nextLumpSumAllowanceUsed.get(person.id) ?? zeroPence(),
        );

        const result = solveDrawdown({
          targetNetAmount: config.targetNetAnnualIncome,
          bandHeadroom,
          pensionBalance,
          lumpSumAllowanceRemaining,
          isaBalance,
        });

        if (config.pensionAccountId) {
          nextAccountBalances.set(config.pensionAccountId, subtractPence(pensionBalance, result.pensionGrossWithdrawn));
        }
        if (config.isaAccountId) {
          nextAccountBalances.set(config.isaAccountId, subtractPence(isaBalance, result.isaGrossWithdrawn));
        }
        nextLumpSumAllowanceUsed.set(
          person.id,
          addPence(nextLumpSumAllowanceUsed.get(person.id) ?? zeroPence(), result.lumpSumAllowanceUsed),
        );

        const taxableAddedThisInstance = sumPence(result.buckets.filter((b) => b.taxCategory !== "taxFree").map((b) => b.amount));
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, taxableAddedThisInstance);

        drawdownGrossWithdrawn = addPence(drawdownGrossWithdrawn, addPence(result.pensionGrossWithdrawn, result.isaGrossWithdrawn));
        drawdownIncomeTax = addPence(drawdownIncomeTax, result.incomeTaxCost);
        drawdownNetAchieved = addPence(drawdownNetAchieved, result.netAchieved);
        drawdownShortfall = drawdownShortfall || result.shortfall;
      }

      const netIncome = addPence(
        subtractPence(subtractPence(subtractPence(grossIncome, incomeTax), nationalInsurance), annualAllowanceCharge),
        drawdownNetAchieved,
      );

      perPerson.push({
        personId: person.id,
        grossIncome,
        grossPensionContribution,
        pensionInputAmount,
        annualAllowanceCharge,
        incomeTax,
        nationalInsurance,
        drawdownGrossWithdrawn,
        drawdownIncomeTax,
        drawdownNetAchieved,
        drawdownShortfall,
        netIncome,
      });
    }

    // 7. Grow every account balance by its own (already-real) growth rate,
    //    net of any pension charge, after this year's contributions and
    //    drawdown withdrawals have already been applied above.
    for (const account of scenario.accounts) {
      const balance = nextAccountBalances.get(account.id) ?? zeroPence();
      const netGrowthRate = account.kind === "pension" ? account.annualGrowthRate - account.annualChargeRate : account.annualGrowthRate;
      nextAccountBalances.set(account.id, growPenceByRate(balance, netGrowthRate));
    }

    accountBalances = nextAccountBalances;
    lumpSumAllowanceUsed = nextLumpSumAllowanceUsed;
    carryForwardWindows = nextCarryForwardWindows;
    rows.push({ taxYear, calendarYear, perPerson, accountBalances: new Map(accountBalances) });
  }

  return { rows };
}

/** Total tax (Income Tax + NI + any Annual Allowance charge + any drawdown Income Tax) across every person, for a given year's ledger row — a small convenience used by golden-file tests and (later) the tax breakdown view. */
export function totalTaxForYear(row: YearLedgerRow): Pence {
  return sumPence(row.perPerson.flatMap((p) => [p.incomeTax, p.nationalInsurance, p.annualAllowanceCharge, p.drawdownIncomeTax]));
}
