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
import { addPence, sumPence, subtractPence, zeroPence, growPenceByRate, multiplyPenceByRate, maxPence, minPence, type Pence } from "../money/pence.js";
import { registry } from "../catalog/registry.js";
import type { DrawdownBucket, ScenarioState, TaxCategory, YearContext } from "../catalog/types.js";
import { isWithinActiveDateRange } from "../schema/activeDateRange.js";
import { prepareRuleSetForScenario } from "../realTerms/prepareRuleSetForScenario.js";
import {
  breakdownIncomeTaxByBand,
  buildFullBandStack,
  computeRemainingBandHeadroom,
  taperPersonalAllowance,
  type IncomeTaxBandBreakdown,
} from "../tax/incomeTax.js";
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
import { calculateSavingsTax, determinePersonalSavingsAllowance } from "../tax/savingsTax.js";
import { calculateDividendTax } from "../tax/dividendTax.js";
import { solveDrawdown } from "../drawdown/solveDrawdown.js";
import type { PensionContributionConfig } from "../catalog/incomeDrains/pensionContribution.js";
import type { IsaContributionConfig } from "../catalog/incomeDrains/isaContribution.js";
import type { GiaContributionConfig } from "../catalog/incomeDrains/giaContribution.js";
import type { CashContributionConfig } from "../catalog/incomeDrains/cashContribution.js";
import type { TargetDrawdownIncomeConfig } from "../catalog/incomeSources/targetDrawdownIncome.js";
import type { GiaAccount, IsaAccount, PersonId, Scenario } from "../schema/types.js";
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

/** One bucket's contribution to a person's drawdown income for the year (SPEC.md §4 journeys 5-6) — the per-instance detail `solveDrawdown` computes, merged across every active drawdown instance rather than discarded once summed into the scalar totals. */
export interface DrawdownBucketDetail {
  readonly bucket: DrawdownBucket;
  readonly taxCategory: TaxCategory;
  readonly amount: Pence;
  readonly taxCost: Pence;
}

export interface PersonYearResult {
  readonly personId: PersonId;
  readonly grossIncome: Pence;
  /** Tax-free income this year (e.g. a one-off inheritance) — adds straight to spendable cash, never taxed. */
  readonly taxFreeIncome: Pence;
  /** The relief-at-source contribution, grossed up at basic rate — this is the amount that extends the basic/higher band ceilings. */
  readonly grossPensionContribution: Pence;
  /** Every pension contribution for the year, gross, from every source and relief method, plus employer contributions — the Annual Allowance test figure. */
  readonly pensionInputAmount: Pence;
  readonly annualAllowanceCharge: Pence;
  readonly incomeTax: Pence;
  /** The band-by-band detail behind `incomeTax` (SPEC.md §4 journey 5) — always sums back to it exactly. Earned/pension income only; drawdown/savings/dividend/CGT each have their own separate breakdown. */
  readonly incomeTaxByBand: readonly IncomeTaxBandBreakdown[];
  readonly nationalInsurance: Pence;
  /** Living expenses, one-off outflows, and any other drain with no account to credit and no tax effect. */
  readonly otherExpenses: Pence;
  /** Total gross withdrawn this year to fund any active drawdown target(s) — pension + ISA + cash + GIA combined (SPEC.md §5.7). */
  readonly drawdownGrossWithdrawn: Pence;
  readonly drawdownIncomeTax: Pence;
  /** CGT on any realised GIA gain drawn down this year — kept separate from Income Tax since it's a different tax entirely. */
  readonly drawdownCapitalGainsTax: Pence;
  /** How much of the drawdown target(s) was actually achieved — may fall short of the target if balances ran out. */
  readonly drawdownNetAchieved: Pence;
  readonly drawdownShortfall: boolean;
  /** Merged across every active drawdown instance this year — see `DrawdownBucketDetail`. */
  readonly drawdownBuckets: readonly DrawdownBucketDetail[];
  /** Interest generated by this person's cash accounts this year (before tax) — reinvested, not paid out as cash (SPEC.md §5.5). */
  readonly savingsInterestIncome: Pence;
  readonly savingsTax: Pence;
  /** Dividends generated by this person's GIA accounts this year (before tax) — reinvested, not paid out as cash (SPEC.md §5.5). */
  readonly dividendIncome: Pence;
  readonly dividendTax: Pence;
  /** Earned-income net plus any drawdown net achieved — the person's total spendable cash for the year. */
  readonly netIncome: Pence;
  /** Any positive `netIncome` not otherwise directed by a contribution drain, automatically invested into an ISA (up to the remaining annual subscription limit) — see `surplusSweptToGia` for the rest. */
  readonly surplusSweptToIsa: Pence;
  /** Surplus beyond the ISA's remaining room (or with no ISA account at all), swept into a GIA instead. */
  readonly surplusSweptToGia: Pence;
}

export interface YearLedgerRow {
  readonly taxYear: string;
  readonly calendarYear: number;
  readonly perPerson: readonly PersonYearResult[];
  readonly accountBalances: ReadonlyMap<string, Pence>;
  /** Each GIA's running cost basis (SPEC.md §3.6) — keyed by account id, present only for `"gia"` accounts. */
  readonly costBasisByAccountId: ReadonlyMap<string, Pence>;
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
  // Each GIA's running cost basis, separate from its balance (SPEC.md
  // §3.6) — grows via contributions and reinvested dividends, tracked
  // from day one since it can't be reconstructed retroactively once a
  // future withdrawal needs it.
  let costBasisByAccountId = new Map<string, Pence>(
    scenario.accounts.filter((a): a is GiaAccount => a.kind === "gia").map((a) => [a.id, a.costBasis]),
  );

  for (let yearIndex = 0; yearIndex < numberOfYears; yearIndex++) {
    const calendarYear = confirmedCalendarYear + yearIndex;
    const taxYear = `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
    const yearContext: YearContext = { taxYear, calendarYear, yearIndex };
    const state: ScenarioState = { scenario, accountBalances };

    const prepared = prepareRuleSetForScenario(confirmedRuleSet, scenario.upratingPolicy, scenario.inflationRate, yearIndex);
    const nextAccountBalances = new Map(accountBalances);
    const nextCarryForwardWindows = new Map(carryForwardWindows);
    const nextLumpSumAllowanceUsed = new Map(lumpSumAllowanceUsed);
    const nextCostBasisByAccountId = new Map(costBasisByAccountId);
    const perPerson: PersonYearResult[] = [];

    for (const person of scenario.household.people) {
      // 1. Sum this person's active income sources: earned income (Salary)
      //    is taxable via Income Tax/NI below; a tax-free source (e.g. a
      //    one-off inheritance) adds straight to spendable cash with no
      //    tax effect at all.
      let grossIncome = zeroPence();
      let taxFreeIncome = zeroPence();
      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id) continue;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = resolveConfig(source.config);
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;
        const result = definition.calculateForYear(config, state, yearContext, source.owner);
        if (result.kind === "simple" && result.taxCategory === "earnedIncome") {
          grossIncome = addPence(grossIncome, result.amount);
        } else if (result.kind === "simple" && result.taxCategory === "taxFree") {
          taxFreeIncome = addPence(taxFreeIncome, result.amount);
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
      let otherExpenses = zeroPence(); // living expenses, one-off outflows — reduce spendable cash, not taxable income
      let isaContributionsThisYear = zeroPence(); // tracked so the surplus-cash sweep below never pushes a person over the combined ISA subscription limit

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
          isaContributionsThisYear = addPence(isaContributionsThisYear, drainResult.amount);
        } else if (drain.type === "giaContribution") {
          const { giaAccountId } = drain.config as GiaContributionConfig;
          const currentBalance = nextAccountBalances.get(giaAccountId) ?? zeroPence();
          nextAccountBalances.set(giaAccountId, addPence(currentBalance, drainResult.amount));
          // New money invested, not a gain — increases cost basis too (SPEC.md §3.6).
          const currentCostBasis = nextCostBasisByAccountId.get(giaAccountId) ?? zeroPence();
          nextCostBasisByAccountId.set(giaAccountId, addPence(currentCostBasis, drainResult.amount));
        } else if (drain.type === "cashContribution") {
          const { cashAccountId } = drain.config as CashContributionConfig;
          const currentBalance = nextAccountBalances.get(cashAccountId) ?? zeroPence();
          nextAccountBalances.set(cashAccountId, addPence(currentBalance, drainResult.amount));
        } else {
          // Living expenses, one-off outflows, and any other drain with no
          // account to credit and no tax effect (SPEC.md §5.1 step 6) —
          // pure spendable-cash reductions. `taxTreatment` is always
          // `"none"` here — every non-"none" value is handled by one of
          // the branches above.
          otherExpenses = addPence(otherExpenses, drainResult.amount);
        }
      }

      // 2b. Employer pension contributions: a flat annual amount credited
      //     directly to the account, never taxed as the employee's income,
      //     but counted toward their Annual Allowance (SPEC.md §3.4, §5.4).
      //     Tied to having an active Salary — an employer can't match a
      //     salary that no longer exists, so this stops automatically
      //     whenever the person's own Salary source(s) do (e.g. at
      //     retirement), with no separate schedule for the user to keep
      //     in sync themselves.
      const hasActiveSalary = scenario.incomeSources.some((source) => {
        if (source.owner !== person.id || source.type !== "salary") return false;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) return false;
        const definition = registry.getIncomeSource(source.type);
        const config = resolveConfig(source.config);
        return definition.isActive(config, state, yearContext, source.owner);
      });
      for (const account of scenario.accounts) {
        if (account.kind !== "pension" || account.owner !== person.id) continue;
        if (!hasActiveSalary) continue;
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
      // The band-by-band breakdown is the single source of truth — `incomeTax`
      // is just this summed, so the two can never drift apart (SPEC.md §4 journey 5).
      const incomeTaxByBand = breakdownIncomeTaxByBand(taxableIncome, fullBands);
      const incomeTax = incomeTaxByBand.reduce((total, b) => addPence(total, b.tax), zeroPence());

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
      //    from this person's accounts at the lowest tax cost, given
      //    whatever band headroom their earned income above has left this
      //    year. A dedicated pass rather than the generic loop in step 1,
      //    because — unlike every other catalog type — this one needs tax
      //    bands and account balances the generic `calculateForYear`
      //    signature doesn't expose (see targetDrawdownIncome.ts). The CGT
      //    Annual Exempt Amount is tracked only *within* this year (unlike
      //    the Lump Sum Allowance) — it's an annual, not lifetime, allowance.
      let drawdownGrossWithdrawn = zeroPence();
      let drawdownIncomeTax = zeroPence();
      let drawdownCapitalGainsTax = zeroPence();
      let drawdownNetAchieved = zeroPence();
      let drawdownShortfall = false;
      let taxableIncomeSoFarForBands = taxableIncome;
      let capitalGainsExemptAmountRemaining = prepared.capitalGainsTax.annualExemptAmount;
      // Bucket detail, merged across every active drawdown instance this
      // year (there's usually just one) — exposed for the tax breakdown
      // view (SPEC.md §4 journey 5) and future drawdown sourcing view
      // (§4 journey 6), rather than discarded once summed into the
      // scalar totals above.
      const drawdownBucketTotals = new Map<DrawdownBucket, { taxCategory: TaxCategory; amount: Pence; taxCost: Pence }>();

      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id || source.type !== "targetDrawdownIncome") continue;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = source.config as TargetDrawdownIncomeConfig;
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;

        const bandHeadroom = computeRemainingBandHeadroom(fullBands, taxableIncomeSoFarForBands);
        const pensionBalance = config.pensionAccountId ? (nextAccountBalances.get(config.pensionAccountId) ?? zeroPence()) : zeroPence();
        const isaBalance = config.isaAccountId ? (nextAccountBalances.get(config.isaAccountId) ?? zeroPence()) : zeroPence();
        const cashBalance = config.cashAccountId ? (nextAccountBalances.get(config.cashAccountId) ?? zeroPence()) : zeroPence();
        const giaBalance = config.giaAccountId ? (nextAccountBalances.get(config.giaAccountId) ?? zeroPence()) : zeroPence();
        const giaCostBasis = config.giaAccountId ? (nextCostBasisByAccountId.get(config.giaAccountId) ?? zeroPence()) : zeroPence();
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
          cashBalance,
          giaBalance,
          giaCostBasis,
          capitalGainsExemptAmountRemaining,
          capitalGainsRates: prepared.capitalGainsTax,
        });

        if (config.pensionAccountId) {
          nextAccountBalances.set(config.pensionAccountId, subtractPence(pensionBalance, result.pensionGrossWithdrawn));
        }
        if (config.isaAccountId) {
          nextAccountBalances.set(config.isaAccountId, subtractPence(isaBalance, result.isaGrossWithdrawn));
        }
        if (config.cashAccountId) {
          nextAccountBalances.set(config.cashAccountId, subtractPence(cashBalance, result.cashGrossWithdrawn));
        }
        if (config.giaAccountId) {
          nextAccountBalances.set(config.giaAccountId, subtractPence(giaBalance, result.giaGrossWithdrawn));
          const returnOfCapital = result.buckets.find((b) => b.bucket === "taxFreeGIAReturnOfCapital")?.amount ?? zeroPence();
          nextCostBasisByAccountId.set(config.giaAccountId, subtractPence(giaCostBasis, returnOfCapital));
        }
        nextLumpSumAllowanceUsed.set(
          person.id,
          addPence(nextLumpSumAllowanceUsed.get(person.id) ?? zeroPence(), result.lumpSumAllowanceUsed),
        );
        capitalGainsExemptAmountRemaining = subtractPence(capitalGainsExemptAmountRemaining, result.capitalGainsExemptAmountUsed);

        // Only ordinary taxable pension income occupies Income Tax band
        // space for subsequent calculations (savings/dividend stacking
        // below, or a second drawdown instance) — capital gains are a
        // separate tax with their own band-position test, not added here.
        const taxableAddedThisInstance = sumPence(result.buckets.filter((b) => b.taxCategory === "pensionIncome").map((b) => b.amount));
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, taxableAddedThisInstance);

        drawdownGrossWithdrawn = addPence(
          drawdownGrossWithdrawn,
          addPence(addPence(result.pensionGrossWithdrawn, result.isaGrossWithdrawn), addPence(result.cashGrossWithdrawn, result.giaGrossWithdrawn)),
        );
        drawdownIncomeTax = addPence(drawdownIncomeTax, result.incomeTaxCost);
        drawdownCapitalGainsTax = addPence(drawdownCapitalGainsTax, result.capitalGainsTaxCost);
        drawdownNetAchieved = addPence(drawdownNetAchieved, result.netAchieved);
        drawdownShortfall = drawdownShortfall || result.shortfall;

        for (const bucket of result.buckets) {
          const existing = drawdownBucketTotals.get(bucket.bucket) ?? { taxCategory: bucket.taxCategory, amount: zeroPence(), taxCost: zeroPence() };
          drawdownBucketTotals.set(bucket.bucket, {
            taxCategory: bucket.taxCategory,
            amount: addPence(existing.amount, bucket.amount),
            taxCost: addPence(existing.taxCost, bucket.taxCost),
          });
        }
      }

      const drawdownBuckets: readonly DrawdownBucketDetail[] = [...drawdownBucketTotals.entries()].map(([bucket, detail]) => ({
        bucket,
        ...detail,
      }));

      // 6b. Cash interest and GIA dividend income (SPEC.md §5.5): each
      //     taxed via its own allowance, stacked *above* earned/pension
      //     income (steps 3 and 6 already used the bands) and, for
      //     dividends, above savings income too — the real HMRC stacking
      //     order. Reinvested in full each year (the buy-and-hold default,
      //     SPEC.md §3.6/§3.7) — the tax due is a separate deduction from
      //     net income below, not withheld from the account itself
      //     (interest/dividends are paid gross in the UK). Joint-owned
      //     accounts aren't attributed to either person yet — the 50/50
      //     split is Phase 5 (SPEC.md §5.5).
      let savingsInterestIncome = zeroPence();
      for (const account of scenario.accounts) {
        if (account.kind !== "cash" || account.owner !== person.id) continue;
        const balance = nextAccountBalances.get(account.id) ?? zeroPence();
        savingsInterestIncome = addPence(savingsInterestIncome, multiplyPenceByRate(balance, account.annualGrowthRate));
      }
      let savingsTax = zeroPence();
      if (savingsInterestIncome > 0) {
        const personalSavingsAllowance = determinePersonalSavingsAllowance(taxableIncomeSoFarForBands, fullBands, prepared.savingsAllowance);
        savingsTax = calculateSavingsTax(taxableIncomeSoFarForBands, savingsInterestIncome, personalSavingsAllowance, fullBands);
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, savingsInterestIncome);
      }

      let dividendIncome = zeroPence();
      for (const account of scenario.accounts) {
        if (account.kind !== "gia" || account.owner !== person.id) continue;
        const balance = nextAccountBalances.get(account.id) ?? zeroPence();
        const dividend = multiplyPenceByRate(balance, account.annualDividendYield);
        dividendIncome = addPence(dividendIncome, dividend);
        nextAccountBalances.set(account.id, addPence(balance, dividend));
        const currentCostBasis = nextCostBasisByAccountId.get(account.id) ?? zeroPence();
        nextCostBasisByAccountId.set(account.id, addPence(currentCostBasis, dividend));
      }
      let dividendTax = zeroPence();
      if (dividendIncome > 0) {
        dividendTax = calculateDividendTax(taxableIncomeSoFarForBands, dividendIncome, prepared.dividendTax.allowance, fullBands, prepared.dividendTax);
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, dividendIncome);
      }

      const netIncome = subtractPence(
        subtractPence(
          addPence(
            addPence(
              subtractPence(subtractPence(subtractPence(grossIncome, incomeTax), nationalInsurance), annualAllowanceCharge),
              drawdownNetAchieved,
            ),
            taxFreeIncome,
          ),
          otherExpenses,
        ),
        addPence(savingsTax, dividendTax),
      );

      // 6c. Surplus cash sweep: any positive net income not otherwise
      //     directed by a contribution drain is automatically invested —
      //     into an ISA first (up to the remaining annual subscription
      //     limit), then a GIA for anything beyond that, rather than left
      //     untracked (this project's own priority order; SPEC.md §5.1
      //     step 7's default is a plain CashAccount). Uses this person's
      //     first ISA/GIA account, if any — v1 scope, matching every
      //     other multi-account mechanism in this engine; no sweep
      //     happens at all if they hold neither. Computed from this
      //     year's already-final net income, so swept money starts
      //     earning interest/dividends from next year, not this one.
      let surplusSweptToIsa = zeroPence();
      let surplusSweptToGia = zeroPence();
      if (netIncome > 0) {
        let surplusLeft = netIncome;
        const isaAccount = scenario.accounts.find((a): a is IsaAccount => a.kind === "isa" && a.owner === person.id);
        if (isaAccount) {
          const isaRoomRemaining = maxPence(subtractPence(prepared.isa.annualSubscriptionLimit, isaContributionsThisYear), zeroPence());
          surplusSweptToIsa = minPence(surplusLeft, isaRoomRemaining);
          if (surplusSweptToIsa > 0) {
            const currentBalance = nextAccountBalances.get(isaAccount.id) ?? zeroPence();
            nextAccountBalances.set(isaAccount.id, addPence(currentBalance, surplusSweptToIsa));
            surplusLeft = subtractPence(surplusLeft, surplusSweptToIsa);
          }
        }
        if (surplusLeft > 0) {
          const giaAccount = scenario.accounts.find((a): a is GiaAccount => a.kind === "gia" && a.owner === person.id);
          if (giaAccount) {
            surplusSweptToGia = surplusLeft;
            const currentBalance = nextAccountBalances.get(giaAccount.id) ?? zeroPence();
            nextAccountBalances.set(giaAccount.id, addPence(currentBalance, surplusSweptToGia));
            // New money invested, not a gain — increases cost basis too (SPEC.md §3.6).
            const currentCostBasis = nextCostBasisByAccountId.get(giaAccount.id) ?? zeroPence();
            nextCostBasisByAccountId.set(giaAccount.id, addPence(currentCostBasis, surplusSweptToGia));
          }
        }
      }

      perPerson.push({
        personId: person.id,
        grossIncome,
        taxFreeIncome,
        grossPensionContribution,
        pensionInputAmount,
        annualAllowanceCharge,
        incomeTax,
        incomeTaxByBand,
        nationalInsurance,
        otherExpenses,
        drawdownGrossWithdrawn,
        drawdownIncomeTax,
        drawdownCapitalGainsTax,
        drawdownNetAchieved,
        savingsInterestIncome,
        savingsTax,
        dividendIncome,
        dividendTax,
        drawdownShortfall,
        drawdownBuckets,
        netIncome,
        surplusSweptToIsa,
        surplusSweptToGia,
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
    costBasisByAccountId = nextCostBasisByAccountId;
    carryForwardWindows = nextCarryForwardWindows;
    rows.push({
      taxYear,
      calendarYear,
      perPerson,
      accountBalances: new Map(accountBalances),
      costBasisByAccountId: new Map(costBasisByAccountId),
    });
  }

  return { rows };
}

/** Total tax (Income Tax + NI + any Annual Allowance charge + any drawdown Income Tax/CGT + savings/dividend Income Tax) across every person, for a given year's ledger row — a small convenience used by golden-file tests and (later) the tax breakdown view. */
export function totalTaxForYear(row: YearLedgerRow): Pence {
  return sumPence(
    row.perPerson.flatMap((p) => [
      p.incomeTax,
      p.nationalInsurance,
      p.annualAllowanceCharge,
      p.drawdownIncomeTax,
      p.drawdownCapitalGainsTax,
      p.savingsTax,
      p.dividendTax,
    ]),
  );
}
