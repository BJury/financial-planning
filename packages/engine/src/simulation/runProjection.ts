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
import {
  addPence,
  compoundPenceByRate,
  sumPence,
  subtractPence,
  zeroPence,
  growPenceByRate,
  multiplyPenceByRate,
  maxPence,
  minPence,
  type Pence,
} from "../money/pence.js";
import { registry } from "../catalog/registry.js";
import type { DrawdownBucket, ScenarioState, TaxCategory, YearContext } from "../catalog/types.js";
import { ageAtYear } from "../schema/age.js";
import { isWithinActiveDateRange } from "../schema/activeDateRange.js";
import { splitByOwnership } from "../schema/jointOwnership.js";
import { prepareRuleSetForScenario } from "../realTerms/prepareRuleSetForScenario.js";
import { deflateNominalAmount } from "../realTerms/deflateNominalAmount.js";
import { amortizeMortgageYear } from "../mortgage/amortizeMortgageYear.js";
import { calculateMortgageInterestCredit, calculateRentalProfit } from "../tax/rentalIncomeTax.js";
import { applyPrivateResidenceRelief } from "../tax/privateResidenceRelief.js";
import { calculateCapitalGainsTax } from "../tax/capitalGainsTax.js";
import { applyMarriageAllowanceTransfer } from "../tax/marriageAllowance.js";
import {
  breakdownIncomeTaxByBand,
  buildFullBandStack,
  computeRemainingBandHeadroom,
  taperPersonalAllowance,
  type IncomeTaxBand,
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
import { solveDrawdown, type DrawdownSolverResult } from "../drawdown/solveDrawdown.js";
import { solveHouseholdDrawdown, type HouseholdDrawdownStrategy } from "../drawdown/solveHouseholdDrawdown.js";
import type { PensionContributionConfig } from "../catalog/incomeDrains/pensionContribution.js";
import type { IsaContributionConfig } from "../catalog/incomeDrains/isaContribution.js";
import type { GiaContributionConfig } from "../catalog/incomeDrains/giaContribution.js";
import type { CashContributionConfig } from "../catalog/incomeDrains/cashContribution.js";
import type { TargetDrawdownIncomeConfig } from "../catalog/incomeSources/targetDrawdownIncome.js";
import type { RentalIncomeConfig } from "../catalog/incomeSources/rentalIncome.js";
import type { GiaAccount, IsaAccount, Owner, Person, PersonId, Property, Scenario } from "../schema/types.js";
import type { TaxYearRuleSet } from "../taxYearData/types.js";

function isProperty(account: Scenario["accounts"][number]): account is Property {
  return account.kind === "property";
}

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
  /** Marriage Allowance (SPEC.md §5.2) given away this year, reducing this person's own Personal Allowance — zero unless they're the elected transferor and were eligible this year. */
  readonly marriageAllowanceGiven: Pence;
  /** Marriage Allowance received this year, increasing this person's own Personal Allowance — zero unless their spouse elected to transfer and both were eligible this year. */
  readonly marriageAllowanceReceived: Pence;
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
  /** Interest generated by this person's cash accounts this year (before tax), including their share of any joint account (SPEC.md §5.5) — reinvested, not paid out as cash. */
  readonly savingsInterestIncome: Pence;
  readonly savingsTax: Pence;
  /** Dividends generated by this person's GIA accounts this year (before tax), including their share of any joint account (SPEC.md §5.5) — reinvested, not paid out as cash. */
  readonly dividendIncome: Pence;
  readonly dividendTax: Pence;
  /** Net rental profit (gross rental income minus whichever of actual letting costs or the Property Income Allowance is larger), including this person's ownership share if the property is jointly held — already folded into `incomeTax`/`incomeTaxByBand` above, since it's taxed at marginal rate stacked with earned/pension income (SPEC.md §5.6). */
  readonly rentalProfitIncome: Pence;
  /** This person's share of the flat-rate mortgage-interest tax credit on any rental property's mortgage (SPEC.md §5.6) — a reduction to the overall tax bill, kept separate from `incomeTax` so that figure still sums exactly from `incomeTaxByBand`. */
  readonly mortgageInterestCredit: Pence;
  /** This person's ownership share of the gain on any property sold this year (SPEC.md §3.8, §5.6) — zero if no sale, or if Private Residence Relief exempted a main residence's gain. */
  readonly propertySaleGain: Pence;
  readonly propertySaleCapitalGainsTax: Pence;
  /** True if any property sold this year was a main residence and so had its gain fully exempted by Private Residence Relief (SPEC.md §5.6) — surfaced so the tax breakdown view can explain *why* no CGT was charged, rather than silently applying relief. */
  readonly propertySalePrivateResidenceReliefApplied: boolean;
  /** This person's share of (sale price minus selling costs minus any mortgage redeemed minus their own CGT) — added to net income like a one-off inflow (SPEC.md §3.8). */
  readonly propertySaleNetProceeds: Pence;
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
  /**
   * Each mortgaged property's outstanding balance, in today's money —
   * keyed by `Property.id`, present only for properties with a mortgage.
   * Tracked separately from `accountBalances` (which holds the
   * property's own market *value*) since a mortgage is a liability, not
   * an account balance — net worth (SPEC.md §7) is `accountBalances`'
   * property entries minus this map's entries.
   */
  readonly mortgageBalanceByPropertyId: ReadonlyMap<string, Pence>;
  /**
   * Survivorship (SPEC.md §5.7.5): populated only in the year a household
   * member's projection reaches their `projectionEndAge` and a survivor
   * remains — from that year on, the deceased no longer appears in
   * `perPerson` at all (the plan continues for the survivor alone), and
   * this flags that their solely-owned ISA/GIA/cash balances were
   * assumed inherited (a v1 modelling assumption to confirm, per SPEC.md
   * §5.7.5 — actual treatment depends on the will/estate; pension
   * death-benefit rules aren't modelled at all, so a deceased person's
   * own pension balance is simply left untouched, neither inherited nor
   * removed).
   */
  readonly survivorshipEvents: readonly { readonly deceasedPersonId: PersonId; readonly survivorPersonId: PersonId }[];
}

export interface ProjectionResult {
  readonly rows: readonly YearLedgerRow[];
}

/** Intermediate, per-person state carried from Pass 1 (income/drains/taxable-income) into the Marriage Allowance step and Pass 2 (SPEC.md §5.1 step 4 sits between these two passes). */
interface Pass1Result {
  readonly person: Person;
  readonly grossIncome: Pence;
  readonly taxFreeIncome: Pence;
  readonly rentalProfitIncome: Pence;
  readonly mortgageInterestCredit: Pence;
  readonly grossPensionContribution: Pence;
  readonly salarySacrificeAmount: Pence;
  readonly pensionInputAmount: Pence;
  readonly otherExpenses: Pence;
  readonly isaContributionsThisYear: Pence;
  readonly taxableIncome: Pence;
  /** The standard rate bands (excluding the Personal Allowance), already widened for any relief-at-source contribution — SPEC.md §5.4. */
  readonly extendedBands: readonly IncomeTaxBand[];
  /** Tapered by this person's own adjusted net income — *before* any Marriage Allowance transfer (SPEC.md §5.2), which is applied on top of this in the step between Pass 1 and Pass 2. */
  readonly taperedAllowancePreMarriageAllowance: Pence;
}

/**
 * The year-by-year simulation loop (SPEC.md §5.1). Deliberately kept as
 * a thin composition of the small pure functions built elsewhere in this
 * package — this function itself must never grow into a "compute the
 * whole year" block (SPEC.md §9.3's core review heuristic).
 *
 * For a two-person household, each person's Income Tax/NI/dividend
 * tax/CGT is still computed fully independently (SPEC.md §5.1) — the
 * only two mechanics that legitimately bridge them are Marriage
 * Allowance (a household-level step between Pass 1 and Pass 2 below) and
 * joint-account/joint-property income splitting (`splitByOwnership`,
 * applied inline wherever an `Owner` can be `"joint"`).
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
  // Each mortgaged property's outstanding balance, tracked in **nominal**
  // pounds throughout — a mortgage is a genuinely nominal, fixed-in-cash-
  // terms contract, unlike every other balance in this engine (see
  // `schema/types.ts`'s `Mortgage` doc comment). Deflated to real terms
  // only at the point it's reported (`YearLedgerRow.mortgageBalanceByPropertyId`
  // below) or used in a real-terms calculation (the interest credit, sale redemption).
  let nominalMortgageBalanceByPropertyId = new Map<string, Pence>(
    scenario.accounts
      .filter(isProperty)
      .flatMap((p) => (p.mortgage ? [[p.id, p.mortgage.initialBalance] as const] : [])),
  );
  // Survivorship (SPEC.md §5.7.5) — once a person's age exceeds their own
  // `projectionEndAge`, they're considered to have died at the *start* of
  // that calendar year (a whole-year-granularity simplification matching
  // everything else in this engine) and stay excluded from every later
  // year too, never "coming back."
  let deceasedPersonIds = new Set<PersonId>();

  for (let yearIndex = 0; yearIndex < numberOfYears; yearIndex++) {
    const calendarYear = confirmedCalendarYear + yearIndex;
    const taxYear = `${calendarYear}-${String((calendarYear + 1) % 100).padStart(2, "0")}`;
    const yearContext: YearContext = { taxYear, calendarYear, yearIndex };

    const nextDeceasedPersonIds = new Set(deceasedPersonIds);
    const survivorshipEvents: { readonly deceasedPersonId: PersonId; readonly survivorPersonId: PersonId }[] = [];
    for (const person of scenario.household.people) {
      if (deceasedPersonIds.has(person.id)) continue;
      if (ageAtYear(person.dateOfBirth, calendarYear) <= person.projectionEndAge) continue;
      nextDeceasedPersonIds.add(person.id);
      const survivor = scenario.household.people.find((p) => p.id !== person.id && !nextDeceasedPersonIds.has(p.id));
      if (!survivor) continue;
      survivorshipEvents.push({ deceasedPersonId: person.id, survivorPersonId: survivor.id });

      // Solely-owned GIA/cash balances (and, for a GIA, cost basis) are
      // assumed inherited by the survivor — merged into the survivor's
      // own first account of the same kind, if they have one. ISAs can't
      // really be merged in real life (no APS mechanism modelled, SPEC.md
      // §5.7.5) and pensions are explicitly out of scope, so both are
      // simply left as they are: still counted in household net worth
      // (SPEC.md §7's account-balance sum doesn't care whose they are),
      // just no longer drawn from or taxed by anyone from this point on.
      for (const kind of ["gia", "cash"] as const) {
        const deceasedAccount = scenario.accounts.find((a) => a.kind === kind && a.owner === person.id);
        const survivorAccount = scenario.accounts.find((a) => a.kind === kind && a.owner === survivor.id);
        if (!deceasedAccount || !survivorAccount) continue;
        const deceasedBalance = accountBalances.get(deceasedAccount.id) ?? zeroPence();
        const survivorBalance = accountBalances.get(survivorAccount.id) ?? zeroPence();
        accountBalances = new Map(accountBalances)
          .set(survivorAccount.id, addPence(survivorBalance, deceasedBalance))
          .set(deceasedAccount.id, zeroPence());
        if (kind === "gia") {
          const deceasedCostBasis = costBasisByAccountId.get(deceasedAccount.id) ?? zeroPence();
          const survivorCostBasis = costBasisByAccountId.get(survivorAccount.id) ?? zeroPence();
          costBasisByAccountId = new Map(costBasisByAccountId)
            .set(survivorAccount.id, addPence(survivorCostBasis, deceasedCostBasis))
            .set(deceasedAccount.id, zeroPence());
        }
      }
    }
    deceasedPersonIds = nextDeceasedPersonIds;
    const alivePeople = scenario.household.people.filter((p) => !deceasedPersonIds.has(p.id));
    const state: ScenarioState = { scenario, accountBalances };

    const prepared = prepareRuleSetForScenario(confirmedRuleSet, scenario.upratingPolicy, scenario.inflationRate, yearIndex);
    const nextAccountBalances = new Map(accountBalances);
    const nextCarryForwardWindows = new Map(carryForwardWindows);
    const nextLumpSumAllowanceUsed = new Map(lumpSumAllowanceUsed);
    const nextCostBasisByAccountId = new Map(costBasisByAccountId);
    const nextNominalMortgageBalanceByPropertyId = new Map(nominalMortgageBalanceByPropertyId);

    // --- Household-level pre-pass -----------------------------------------
    // Rental profit, mortgage amortisation/interest credit, cash interest,
    // and GIA dividends are all computed once per account/property here —
    // never once per matching person — because (a) some have reinvestment
    // side effects (dividends, mortgage balance) that must apply exactly
    // once regardless of how many people share ownership, and (b) even the
    // side-effect-free ones (rental profit) read a shared balance that a
    // naive per-person loop could mutate out from under a second owner
    // mid-computation. Each person's *tax* attribution is a per-person
    // ownership-share split of these totals, applied in Pass 1/2 below
    // (SPEC.md §5.5, §5.6's joint splitting).
    const rentalProfitByPropertyId = new Map<string, Pence>();
    for (const source of scenario.incomeSources) {
      if (source.type !== "rentalIncome") continue;
      if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
      const definition = registry.getIncomeSource("rentalIncome");
      const config = source.config as RentalIncomeConfig;
      if (!definition.isActive(config, state, yearContext, source.owner)) continue;

      const property = scenario.accounts.find((a): a is Property => isProperty(a) && a.id === config.propertyId);
      if (!property?.rentalDetails) continue;
      const grossRental = compoundPenceByRate(property.rentalDetails.grossAnnualRentalIncome, property.rentalDetails.annualGrowthRate, yearIndex);
      const lettingCosts = compoundPenceByRate(property.rentalDetails.lettingCosts, property.rentalDetails.annualGrowthRate, yearIndex);
      const profit = calculateRentalProfit(grossRental, lettingCosts, prepared.property.incomeAllowance);
      rentalProfitByPropertyId.set(property.id, addPence(rentalProfitByPropertyId.get(property.id) ?? zeroPence(), profit));
    }

    const mortgageInterestCreditByPropertyId = new Map<string, Pence>();
    for (const property of scenario.accounts.filter(isProperty)) {
      if (!property.mortgage) continue;
      const saleYear = property.plannedSale ? new Date(property.plannedSale.saleDate).getUTCFullYear() : undefined;
      // No amortisation happens in a property's sale year (or after) — the
      // outstanding balance is redeemed in full instead (property-sale step below).
      if (saleYear !== undefined && yearContext.calendarYear >= saleYear) continue;

      const nominalBalance = nominalMortgageBalanceByPropertyId.get(property.id) ?? property.mortgage.initialBalance;
      const amortization = amortizeMortgageYear(nominalBalance, property.mortgage, yearIndex);
      nextNominalMortgageBalanceByPropertyId.set(property.id, amortization.nominalBalanceAfter);

      if (property.rentalDetails) {
        const realInterest = deflateNominalAmount(amortization.nominalInterest, scenario.inflationRate, yearIndex);
        mortgageInterestCreditByPropertyId.set(
          property.id,
          calculateMortgageInterestCredit(realInterest, prepared.property.mortgageInterestReliefRate),
        );
      }
    }

    const cashInterestByAccountId = new Map<string, Pence>();
    const giaDividendByAccountId = new Map<string, Pence>();
    for (const account of scenario.accounts) {
      if (account.kind === "cash") {
        const balance = nextAccountBalances.get(account.id) ?? zeroPence();
        cashInterestByAccountId.set(account.id, multiplyPenceByRate(balance, account.annualGrowthRate));
      } else if (account.kind === "gia") {
        const balance = nextAccountBalances.get(account.id) ?? zeroPence();
        const dividend = multiplyPenceByRate(balance, account.annualDividendYield);
        giaDividendByAccountId.set(account.id, dividend);
        // Reinvested in full each year (the buy-and-hold default, SPEC.md
        // §3.6) — applied exactly once here, before any per-person split.
        nextAccountBalances.set(account.id, addPence(balance, dividend));
        const currentCostBasis = nextCostBasisByAccountId.get(account.id) ?? zeroPence();
        nextCostBasisByAccountId.set(account.id, addPence(currentCostBasis, dividend));
      }
    }

    // Splits against `alivePeople`, not the Scenario's full static list —
    // once one joint owner has died, a joint amount attributes entirely
    // to the survivor (`splitByOwnership`'s own single-person fallback,
    // SPEC.md §5.7.5), with no code path change needed here.
    const ownershipShareFor = (amount: Pence, owner: Owner, personId: PersonId): Pence =>
      splitByOwnership(amount, owner, alivePeople).get(personId) ?? zeroPence();

    // --- Pass 1: income sources, drains, and each person's own
    // pre-Marriage-Allowance taxable income / tapered Personal Allowance.
    // Only the household's currently-alive members (SPEC.md §5.7.5) —
    // once someone's projection has ended, the plan continues for the
    // survivor alone; the deceased simply stops appearing from here on.
    const pass1Results: Pass1Result[] = alivePeople.map((person) => {
      // 1. Sum this person's active income sources: earned income (Salary)
      //    is taxable via Income Tax/NI below; a tax-free source (e.g. a
      //    one-off inheritance) adds straight to spendable cash with no
      //    tax effect at all. A joint-owned source (e.g. a shared one-off
      //    inflow) is split by ownership share before either use.
      let grossIncome = zeroPence();
      let taxFreeIncome = zeroPence();
      for (const source of scenario.incomeSources) {
        if (source.owner !== person.id && source.owner !== "joint") continue;
        if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeSource(source.type);
        const config = resolveConfig(source.config);
        if (!definition.isActive(config, state, yearContext, source.owner)) continue;
        const result = definition.calculateForYear(config, state, yearContext, source.owner);
        if (result.kind !== "simple") continue;
        const amount = ownershipShareFor(result.amount, source.owner, person.id);
        if (result.taxCategory === "earnedIncome") {
          grossIncome = addPence(grossIncome, amount);
        } else if (result.taxCategory === "taxFree") {
          taxFreeIncome = addPence(taxFreeIncome, amount);
        }
        // Other tax categories (pensionIncome, rentalProfit, etc.) are handled by their own dedicated passes below.
      }

      // This person's ownership share of the pre-pass rental profit total
      // (SPEC.md §5.6) — folded into `taxableIncome` below (not
      // `grossIncome`), since rental profit isn't subject to NI, only
      // Income Tax at marginal rate stacked alongside earned/pension income.
      let rentalProfitIncome = zeroPence();
      for (const [propertyId, totalProfit] of rentalProfitByPropertyId) {
        const property = scenario.accounts.find((a) => a.id === propertyId);
        if (!property) continue;
        rentalProfitIncome = addPence(rentalProfitIncome, ownershipShareFor(totalProfit, property.owner, person.id));
      }

      let mortgageInterestCredit = zeroPence();
      for (const [propertyId, totalCredit] of mortgageInterestCreditByPropertyId) {
        const property = scenario.accounts.find((a) => a.id === propertyId);
        if (!property) continue;
        mortgageInterestCredit = addPence(mortgageInterestCredit, ownershipShareFor(totalCredit, property.owner, person.id));
      }

      // 2. Sum this person's active pension/ISA drains, applying each
      //    relief method's own effect (SPEC.md §5.4): relief-at-source is
      //    grossed up into its account and extends the tax bands; net pay
      //    and salary sacrifice are deducted from gross pay before tax
      //    (and, for salary sacrifice, before NI too) and credited to the
      //    account at face value; an ISA contribution has no tax effect.
      //    A joint-owned drain (e.g. a shared mortgage payment) is split
      //    by ownership share before use — the account-crediting side
      //    effect below still ends up crediting the full amount exactly
      //    once in total, since both owners' shares are processed and sum
      //    back to the original amount by construction (`splitByOwnership`).
      let grossPensionContribution = zeroPence(); // relief-at-source only — extends the band ceilings
      let taxableIncomeReduction = zeroPence(); // net pay + salary sacrifice
      let salarySacrificeAmount = zeroPence(); // salary sacrifice only — also reduces NIable income
      let pensionInputAmount = zeroPence(); // every method's gross contribution, plus employer contributions below — the Annual Allowance figure
      let otherExpenses = zeroPence(); // living expenses, one-off outflows — reduce spendable cash, not taxable income
      let isaContributionsThisYear = zeroPence(); // tracked so the surplus-cash sweep below never pushes a person over the combined ISA subscription limit

      for (const drain of scenario.incomeDrains) {
        if (drain.owner !== person.id && drain.owner !== "joint") continue;
        if (!isWithinActiveDateRange(drain.startDate, drain.endDate, yearContext.calendarYear)) continue;
        const definition = registry.getIncomeDrain(drain.type);
        const config = resolveConfig(drain.config);
        if (!definition.isActive(config, state, yearContext, drain.owner)) continue;
        const rawDrainResult = definition.calculateForYear(config, state, yearContext, drain.owner);
        const amount = ownershipShareFor(rawDrainResult.amount, drain.owner, person.id);
        const drainResult = { amount, taxTreatment: rawDrainResult.taxTreatment };

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
      //     Pensions can never be jointly held, so no splitting applies
      //     here. Tied to having an active Salary — an employer can't
      //     match a salary that no longer exists, so this stops
      //     automatically whenever the person's own Salary source(s) do
      //     (e.g. at retirement), with no separate schedule for the user
      //     to keep in sync themselves.
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

      // 3 (part 1). Taxable income and the tapered Personal Allowance,
      //    *before* any Marriage Allowance transfer — net pay/salary
      //    sacrifice reduce taxable income directly; relief-at-source
      //    extends the basic/higher band ceilings instead and separately
      //    reduces adjusted net income for the taper. Rental profit stacks
      //    in here too — it's taxed at marginal rate alongside
      //    earned/pension income, not via a separate rate.
      const taxableIncome = applyNetPayRelief(addPence(grossIncome, rentalProfitIncome), taxableIncomeReduction);
      const extendedBands = extendBandsForReliefAtSource(prepared.incomeTaxBands, grossPensionContribution);
      const adjustedNetIncomeForPersonalAllowance = subtractPence(taxableIncome, grossPensionContribution);
      const taperedAllowancePreMarriageAllowance = taperPersonalAllowance(
        adjustedNetIncomeForPersonalAllowance,
        prepared.personalAllowance,
        prepared.personalAllowanceTaperThreshold,
        prepared.personalAllowanceTaperRate,
      );

      return {
        person,
        grossIncome,
        taxFreeIncome,
        rentalProfitIncome,
        mortgageInterestCredit,
        grossPensionContribution,
        salarySacrificeAmount,
        pensionInputAmount,
        otherExpenses,
        isaContributionsThisYear,
        taxableIncome,
        extendedBands,
        taperedAllowancePreMarriageAllowance,
      };
    });

    // --- Marriage Allowance (SPEC.md §5.1 step 4, §5.2) ---------------------
    // A household-level step, deliberately sitting between Pass 1 and
    // Pass 2 — one of the few places this engine computes one person's
    // Income Tax using a number derived from the other person's position.
    // Eligibility (not just the user's election) is checked fresh every
    // year: the transferor must not need their full Personal Allowance,
    // and the recipient must remain a basic-rate taxpayer.
    const marriageAllowanceAdjustment = new Map<PersonId, Pence>();
    const marriageAllowanceGiven = new Map<PersonId, Pence>();
    const marriageAllowanceReceived = new Map<PersonId, Pence>();
    if (
      scenario.household.relationshipStatus === "marriedOrCivilPartnership" &&
      scenario.household.marriageAllowanceElection !== undefined &&
      pass1Results.length === 2
    ) {
      const transferorId = scenario.household.marriageAllowanceElection;
      const transferor = pass1Results.find((p) => p.person.id === transferorId);
      const recipient = pass1Results.find((p) => p.person.id !== transferorId);
      if (transferor && recipient) {
        const recipientBasicRateUpperThreshold =
          recipient.extendedBands.find((b) => b.name === "basic")?.upTo ?? recipient.taperedAllowancePreMarriageAllowance;
        const transfer = applyMarriageAllowanceTransfer(
          transferor.taxableIncome,
          transferor.taperedAllowancePreMarriageAllowance,
          recipient.taxableIncome,
          recipientBasicRateUpperThreshold,
          prepared.marriageAllowanceTransferableAmount,
        );
        if (transfer.applied) {
          marriageAllowanceAdjustment.set(transferor.person.id, subtractPence(zeroPence(), transfer.transferorAllowanceReduction));
          marriageAllowanceAdjustment.set(recipient.person.id, transfer.recipientAllowanceIncrease);
          marriageAllowanceGiven.set(transferor.person.id, transfer.transferorAllowanceReduction);
          marriageAllowanceReceived.set(recipient.person.id, transfer.recipientAllowanceIncrease);
        }
      }
    }

    // --- Pass 2a: Income Tax through Annual Allowance, per person — split
    // out from what used to be a single Pass 2 because the drawdown step
    // that used to sit here now needs *both* people's tax positions at
    // once for a jointly-owned target (SPEC.md §5.7.4), which a plain
    // per-person `.map()` can't provide.
    const pass2aResults = pass1Results.map((pass1) => {
      const { person } = pass1;
      const taperedAllowance = maxPence(
        addPence(pass1.taperedAllowancePreMarriageAllowance, marriageAllowanceAdjustment.get(person.id) ?? zeroPence()),
        zeroPence(),
      );
      const fullBands = buildFullBandStack(taperedAllowance, pass1.extendedBands);
      // The band-by-band breakdown is the single source of truth — `incomeTax`
      // is just this summed, so the two can never drift apart (SPEC.md §4 journey 5).
      const incomeTaxByBand = breakdownIncomeTaxByBand(pass1.taxableIncome, fullBands);
      const incomeTax = incomeTaxByBand.reduce((total, b) => addPence(total, b.tax), zeroPence());

      // 3b. Property sale (SPEC.md §3.8, §5.6): triggers in the calendar
      //     year containing a property's `plannedSale.saleDate`. Shares
      //     `capitalGainsExemptAmountRemaining` with the drawdown step's
      //     GIA CGT below — both draw on the same one Annual Exempt
      //     Amount a person has for the year; property sale is assessed
      //     first (an arbitrary but documented ordering choice, since a
      //     large one-off gain and a drawdown-driven gain can't both
      //     claim the same allowance twice). A jointly-owned property's
      //     gain, sale price, and mortgage redemption are all split by
      //     ownership share (SPEC.md §5.6) *before* each person's own CGT
      //     is computed against their own Annual Exempt Amount and bands
      //     — CGT itself can never be computed once and split, unlike
      //     rental profit, since each person's own tax position differs.
      //     A main residence's gain is assumed exempt via Private
      //     Residence Relief for the property's whole ownership period
      //     (the common-case simplification SPEC.md §5.6 explicitly
      //     permits) and never touches the exempt amount at all. No
      //     rental income or mortgage amortisation is modelled in the
      //     sale year itself (the pre-pass already excluded it) —
      //     whatever mortgage balance was carried into this year is
      //     redeemed from proceeds in full, a whole-year-granularity
      //     simplification.
      let capitalGainsExemptAmountRemaining = prepared.capitalGainsTax.annualExemptAmount;
      let propertySaleGain = zeroPence();
      let propertySaleCapitalGainsTax = zeroPence();
      let propertySalePrivateResidenceReliefApplied = false;
      let propertySaleNetProceeds = zeroPence();
      for (const property of scenario.accounts.filter(isProperty)) {
        if ((property.owner !== person.id && property.owner !== "joint") || !property.plannedSale) continue;
        const saleYear = new Date(property.plannedSale.saleDate).getUTCFullYear();
        if (saleYear !== yearContext.calendarYear) continue;

        const currentValue = nextAccountBalances.get(property.id) ?? property.currentBalance;
        const salePrice = property.plannedSale.expectedSalePrice ?? currentValue;
        const sellingCosts = property.plannedSale.sellingCosts;
        const nominalMortgageBalance = nominalMortgageBalanceByPropertyId.get(property.id) ?? zeroPence();
        const mortgageRedeemed = deflateNominalAmount(nominalMortgageBalance, scenario.inflationRate, yearIndex);
        const fullGain = maxPence(subtractPence(subtractPence(salePrice, property.purchasePrice), sellingCosts), zeroPence());
        const fullNetProceedsBeforeCgt = subtractPence(subtractPence(salePrice, sellingCosts), mortgageRedeemed);

        const gainShare = ownershipShareFor(fullGain, property.owner, person.id);
        const netProceedsBeforeCgtShare = ownershipShareFor(fullNetProceedsBeforeCgt, property.owner, person.id);

        let cgt: Pence;
        if (property.propertyType === "mainResidence") {
          cgt = applyPrivateResidenceRelief(gainShare);
          propertySalePrivateResidenceReliefApplied = true;
        } else {
          cgt = calculateCapitalGainsTax(pass1.taxableIncome, gainShare, capitalGainsExemptAmountRemaining, fullBands, {
            basicRate: prepared.property.cgtResidentialBasicRate,
            higherRate: prepared.property.cgtResidentialHigherRate,
          });
          const exemptAmountUsedThisSale = minPence(gainShare, capitalGainsExemptAmountRemaining);
          capitalGainsExemptAmountRemaining = subtractPence(capitalGainsExemptAmountRemaining, exemptAmountUsedThisSale);
        }

        propertySaleGain = addPence(propertySaleGain, gainShare);
        propertySaleCapitalGainsTax = addPence(propertySaleCapitalGainsTax, cgt);
        propertySaleNetProceeds = addPence(propertySaleNetProceeds, subtractPence(netProceedsBeforeCgtShare, cgt));

        // The property is gone and its mortgage redeemed — zero both out
        // so future years' net worth doesn't double-count them. Harmless
        // to repeat for a joint property's second owner: setting the same
        // value twice is idempotent.
        nextAccountBalances.set(property.id, zeroPence());
        nextNominalMortgageBalanceByPropertyId.set(property.id, zeroPence());
      }

      // 4. National Insurance — independent of Income Tax (SPEC.md §5.3,
      //    §9.3); only salary sacrifice reduces NIable pay.
      const niableIncome = applySalarySacrifice(pass1.grossIncome, pass1.salarySacrificeAmount);
      const nationalInsurance = calculateNI(niableIncome, prepared.nationalInsurance);

      // 5. Annual Allowance: taper this person's allowance by their
      //    threshold/adjusted income, consume this year's (then any
      //    carried-forward) allowance, and charge any true excess at
      //    their marginal rate (SPEC.md §5.4).
      const { thresholdIncome, adjustedIncome } = calculateThresholdAndAdjustedIncome({
        taxableIncomeAfterPensionDeductions: pass1.taxableIncome,
        salarySacrificeAmount: pass1.salarySacrificeAmount,
        totalPensionInputAmount: pass1.pensionInputAmount,
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
        totalContribution: pass1.pensionInputAmount,
        currentYearAllowance: taperedAnnualAllowance,
        unusedAllowanceByPreviousThreeYears: carryForwardWindows.get(person.id) ?? emptyCarryForwardWindow(),
      });
      nextCarryForwardWindows.set(person.id, carryForwardResult.nextUnusedAllowanceByPreviousThreeYears);
      const annualAllowanceCharge = calculateAnnualAllowanceCharge(pass1.taxableIncome, carryForwardResult.excessContribution, fullBands);

      return {
        pass1,
        fullBands,
        incomeTax,
        incomeTaxByBand,
        propertySaleGain,
        propertySaleCapitalGainsTax,
        propertySalePrivateResidenceReliefApplied,
        propertySaleNetProceeds,
        nationalInsurance,
        annualAllowanceCharge,
        capitalGainsExemptAmountRemainingAfterPropertySale: capitalGainsExemptAmountRemaining,
      };
    });

    // --- Household-level drawdown step (SPEC.md §5.7) ------------------------
    // Sits between Pass 2a and Pass 2b because it needs both: this year's
    // finalised tax bands (Pass 2a) to know each person's band headroom,
    // and its own results feed into Pass 2b's dividend/interest stacking
    // and net income. A dedicated pass rather than the generic loop in
    // step 1, because — unlike every other catalog type — this one needs
    // tax bands and account balances the generic `calculateForYear`
    // signature doesn't expose (see targetDrawdownIncome.ts). Mutable
    // per-person accumulators (not a `.map()`) because a single *joint*
    // instance can update both people's totals from one `solveDrawdown`-
    // adjacent call, and multiple instances (of either scope) can
    // legitimately coexist in the same year.
    interface DrawdownAccumulator {
      grossWithdrawn: Pence;
      incomeTax: Pence;
      capitalGainsTax: Pence;
      netAchieved: Pence;
      shortfall: boolean;
      readonly bucketTotals: Map<DrawdownBucket, { taxCategory: TaxCategory; amount: Pence; taxCost: Pence }>;
      /** Starts at this person's own taxable income (post property sale); climbs as drawdown/dividends/interest consume band space. */
      taxableIncomeSoFarForBands: Pence;
      /** Starts at this person's own remaining Annual Exempt Amount (post property sale) — an annual, not lifetime, allowance (SPEC.md §5.5). */
      capitalGainsExemptAmountRemaining: Pence;
    }
    const drawdownAccumulators = new Map<PersonId, DrawdownAccumulator>(
      pass2aResults.map((p) => [
        p.pass1.person.id,
        {
          grossWithdrawn: zeroPence(),
          incomeTax: zeroPence(),
          capitalGainsTax: zeroPence(),
          netAchieved: zeroPence(),
          shortfall: false,
          bucketTotals: new Map(),
          taxableIncomeSoFarForBands: p.pass1.taxableIncome,
          capitalGainsExemptAmountRemaining: p.capitalGainsExemptAmountRemainingAfterPropertySale,
        },
      ]),
    );

    const mergeBucketsInto = (accumulator: DrawdownAccumulator, buckets: readonly { bucket: DrawdownBucket; taxCategory: TaxCategory; amount: Pence; taxCost: Pence }[]) => {
      for (const bucket of buckets) {
        const existing = accumulator.bucketTotals.get(bucket.bucket) ?? { taxCategory: bucket.taxCategory, amount: zeroPence(), taxCost: zeroPence() };
        accumulator.bucketTotals.set(bucket.bucket, {
          taxCategory: bucket.taxCategory,
          amount: addPence(existing.amount, bucket.amount),
          taxCost: addPence(existing.taxCost, bucket.taxCost),
        });
      }
    };

    const applyDrawdownResultToAccumulator = (personId: PersonId, result: DrawdownSolverResult) => {
      const accumulator = drawdownAccumulators.get(personId);
      if (!accumulator) return;
      // Only ordinary taxable pension income occupies Income Tax band
      // space for subsequent calculations (savings/dividend stacking, or
      // a second drawdown instance) — capital gains are a separate tax
      // with their own band-position test, not added here.
      const taxableAddedThisInstance = sumPence(result.buckets.filter((b) => b.taxCategory === "pensionIncome").map((b) => b.amount));
      accumulator.taxableIncomeSoFarForBands = addPence(accumulator.taxableIncomeSoFarForBands, taxableAddedThisInstance);
      accumulator.capitalGainsExemptAmountRemaining = subtractPence(accumulator.capitalGainsExemptAmountRemaining, result.capitalGainsExemptAmountUsed);
      accumulator.grossWithdrawn = addPence(
        accumulator.grossWithdrawn,
        addPence(addPence(result.pensionGrossWithdrawn, result.isaGrossWithdrawn), addPence(result.cashGrossWithdrawn, result.giaGrossWithdrawn)),
      );
      accumulator.incomeTax = addPence(accumulator.incomeTax, result.incomeTaxCost);
      accumulator.capitalGainsTax = addPence(accumulator.capitalGainsTax, result.capitalGainsTaxCost);
      accumulator.netAchieved = addPence(accumulator.netAchieved, result.netAchieved);
      accumulator.shortfall = accumulator.shortfall || result.shortfall;
      mergeBucketsInto(accumulator, result.buckets);
    };

    /** This person's own pension/ISA (never joint) and cash/GIA (their own, else a joint one) — v1 scope: at most one of each (matches `solveDrawdown`'s own documented limit). Used only for a *joint* target — a person-scoped target still uses its own config's explicit account ids (`discoverConfiguredAccountIds`), unchanged from before. */
    const discoverAccountIds = (personId: PersonId) => ({
      pensionAccountId: scenario.accounts.find((a) => a.kind === "pension" && a.owner === personId)?.id,
      isaAccountId: scenario.accounts.find((a) => a.kind === "isa" && a.owner === personId)?.id,
      cashAccountId: scenario.accounts.find((a) => a.kind === "cash" && (a.owner === personId || a.owner === "joint"))?.id,
      giaAccountId: scenario.accounts.find((a) => a.kind === "gia" && (a.owner === personId || a.owner === "joint"))?.id,
    });

    /** A person-scoped target still draws only from the accounts explicitly picked in its own config — unlike a joint target, which auto-discovers (`discoverAccountIds` above). */
    const discoverConfiguredAccountIds = (config: TargetDrawdownIncomeConfig) => ({
      pensionAccountId: config.pensionAccountId,
      isaAccountId: config.isaAccountId,
      cashAccountId: config.cashAccountId,
      giaAccountId: config.giaAccountId,
    });

    const balancesFor = (accountIds: ReturnType<typeof discoverAccountIds>) => ({
      pensionBalance: accountIds.pensionAccountId ? (nextAccountBalances.get(accountIds.pensionAccountId) ?? zeroPence()) : zeroPence(),
      isaBalance: accountIds.isaAccountId ? (nextAccountBalances.get(accountIds.isaAccountId) ?? zeroPence()) : zeroPence(),
      cashBalance: accountIds.cashAccountId ? (nextAccountBalances.get(accountIds.cashAccountId) ?? zeroPence()) : zeroPence(),
      giaBalance: accountIds.giaAccountId ? (nextAccountBalances.get(accountIds.giaAccountId) ?? zeroPence()) : zeroPence(),
      giaCostBasis: accountIds.giaAccountId ? (nextCostBasisByAccountId.get(accountIds.giaAccountId) ?? zeroPence()) : zeroPence(),
    });

    const creditAccountsAfterDrawdown = (accountIds: ReturnType<typeof discoverAccountIds>, balances: ReturnType<typeof balancesFor>, result: DrawdownSolverResult) => {
      if (accountIds.pensionAccountId) {
        nextAccountBalances.set(accountIds.pensionAccountId, subtractPence(balances.pensionBalance, result.pensionGrossWithdrawn));
      }
      if (accountIds.isaAccountId) {
        nextAccountBalances.set(accountIds.isaAccountId, subtractPence(balances.isaBalance, result.isaGrossWithdrawn));
      }
      if (accountIds.cashAccountId) {
        nextAccountBalances.set(accountIds.cashAccountId, subtractPence(balances.cashBalance, result.cashGrossWithdrawn));
      }
      if (accountIds.giaAccountId) {
        nextAccountBalances.set(accountIds.giaAccountId, subtractPence(balances.giaBalance, result.giaGrossWithdrawn));
        const returnOfCapital = result.buckets.find((b) => b.bucket === "taxFreeGIAReturnOfCapital")?.amount ?? zeroPence();
        nextCostBasisByAccountId.set(accountIds.giaAccountId, subtractPence(balances.giaCostBasis, returnOfCapital));
      }
    };

    for (const source of scenario.incomeSources) {
      if (source.type !== "targetDrawdownIncome") continue;
      if (!isWithinActiveDateRange(source.startDate, source.endDate, yearContext.calendarYear)) continue;
      const definition = registry.getIncomeSource(source.type);
      const config = source.config as TargetDrawdownIncomeConfig;
      if (!definition.isActive(config, state, yearContext, source.owner)) continue;

      if (source.owner === "joint") {
        // Household drawdown optimisation (SPEC.md §5.7.4) — which person
        // draws which bucket first is itself part of the optimisation,
        // since Personal Allowance/band headroom/allowances are all
        // per-person. Each person's own accounts are auto-discovered
        // (never the config's `pensionAccountId` etc., which are only
        // meaningful for a person-scoped target) — a joint target draws
        // from whatever pension/ISA each person individually holds, plus
        // either person's own or a shared cash/GIA.
        const eligiblePeople = pass2aResults.filter((p) => drawdownAccumulators.has(p.pass1.person.id));
        const accountIdsByPerson = new Map(eligiblePeople.map((p) => [p.pass1.person.id, discoverAccountIds(p.pass1.person.id)]));
        const householdPeopleInputs = eligiblePeople.map((p) => {
          const accountIds = accountIdsByPerson.get(p.pass1.person.id);
          const balances = balancesFor(accountIds ?? discoverAccountIds(p.pass1.person.id));
          const accumulator = drawdownAccumulators.get(p.pass1.person.id);
          const lumpSumAllowanceRemaining = subtractPence(
            prepared.pensions.lumpSumAllowance,
            nextLumpSumAllowanceUsed.get(p.pass1.person.id) ?? zeroPence(),
          );
          return {
            id: p.pass1.person.id,
            state: {
              bandHeadroom: computeRemainingBandHeadroom(p.fullBands, accumulator?.taxableIncomeSoFarForBands ?? p.pass1.taxableIncome),
              lumpSumAllowanceRemaining,
              capitalGainsExemptAmountRemaining: accumulator?.capitalGainsExemptAmountRemaining ?? zeroPence(),
              ...balances,
            },
          };
        });

        const strategy: HouseholdDrawdownStrategy =
          config.householdSplitStrategy === "even"
            ? { kind: "even" }
            : config.householdSplitStrategy === "custom"
              ? { kind: "custom", firstPersonShare: config.customFirstPersonShare ?? 0.5 }
              : { kind: "optimised" };

        const householdResult = solveHouseholdDrawdown(config.targetNetAnnualIncome, strategy, householdPeopleInputs, prepared.capitalGainsTax);

        for (const { id: personId, result } of householdResult.perPerson) {
          const accountIds = accountIdsByPerson.get(personId) ?? discoverAccountIds(personId);
          const balances = balancesFor(accountIds);
          creditAccountsAfterDrawdown(accountIds, balances, result);
          nextLumpSumAllowanceUsed.set(personId, addPence(nextLumpSumAllowanceUsed.get(personId) ?? zeroPence(), result.lumpSumAllowanceUsed));
          applyDrawdownResultToAccumulator(personId, result);
        }
        continue;
      }

      const pass2a = pass2aResults.find((p) => p.pass1.person.id === source.owner);
      const accumulator = drawdownAccumulators.get(source.owner);
      if (!pass2a || !accumulator) continue;

      const accountIds = discoverConfiguredAccountIds(config);
      const balances = balancesFor(accountIds);
      const lumpSumAllowanceRemaining = subtractPence(prepared.pensions.lumpSumAllowance, nextLumpSumAllowanceUsed.get(source.owner) ?? zeroPence());

      const result = solveDrawdown({
        targetNetAmount: config.targetNetAnnualIncome,
        bandHeadroom: computeRemainingBandHeadroom(pass2a.fullBands, accumulator.taxableIncomeSoFarForBands),
        lumpSumAllowanceRemaining,
        capitalGainsExemptAmountRemaining: accumulator.capitalGainsExemptAmountRemaining,
        capitalGainsRates: prepared.capitalGainsTax,
        ...balances,
      });

      creditAccountsAfterDrawdown(accountIds, balances, result);
      nextLumpSumAllowanceUsed.set(source.owner, addPence(nextLumpSumAllowanceUsed.get(source.owner) ?? zeroPence(), result.lumpSumAllowanceUsed));
      applyDrawdownResultToAccumulator(source.owner, result);
    }

    // --- Pass 2b: dividends/interest onward, per person, using the
    // household drawdown step's results.
    const perPerson: PersonYearResult[] = pass2aResults.map((pass2a) => {
      const { person } = pass2a.pass1;
      const pass1 = pass2a.pass1;
      const fullBands = pass2a.fullBands;
      const incomeTax = pass2a.incomeTax;
      const incomeTaxByBand = pass2a.incomeTaxByBand;
      const propertySaleGain = pass2a.propertySaleGain;
      const propertySaleCapitalGainsTax = pass2a.propertySaleCapitalGainsTax;
      const propertySalePrivateResidenceReliefApplied = pass2a.propertySalePrivateResidenceReliefApplied;
      const propertySaleNetProceeds = pass2a.propertySaleNetProceeds;
      const nationalInsurance = pass2a.nationalInsurance;
      const annualAllowanceCharge = pass2a.annualAllowanceCharge;

      const accumulator = drawdownAccumulators.get(person.id);
      const drawdownGrossWithdrawn = accumulator?.grossWithdrawn ?? zeroPence();
      const drawdownIncomeTax = accumulator?.incomeTax ?? zeroPence();
      const drawdownCapitalGainsTax = accumulator?.capitalGainsTax ?? zeroPence();
      const drawdownNetAchieved = accumulator?.netAchieved ?? zeroPence();
      const drawdownShortfall = accumulator?.shortfall ?? false;
      let taxableIncomeSoFarForBands = accumulator?.taxableIncomeSoFarForBands ?? pass1.taxableIncome;
      const drawdownBuckets: readonly DrawdownBucketDetail[] = accumulator
        ? [...accumulator.bucketTotals.entries()].map(([bucket, detail]) => ({ bucket, ...detail }))
        : [];

      // 6b. Cash interest and GIA dividend income (SPEC.md §5.5): each
      //     taxed via its own allowance, stacked *above* earned/pension
      //     income (steps 3 and 6 already used the bands) and, for
      //     dividends, above savings income too — the real HMRC stacking
      //     order. The totals were already computed once per account (and
      //     reinvested) in the household-level pre-pass above; this is
      //     just each person's ownership-share split of them for tax
      //     purposes (SPEC.md §5.5's joint splitting).
      let savingsInterestIncome = zeroPence();
      for (const account of scenario.accounts) {
        if (account.kind !== "cash" || (account.owner !== person.id && account.owner !== "joint")) continue;
        const total = cashInterestByAccountId.get(account.id) ?? zeroPence();
        savingsInterestIncome = addPence(savingsInterestIncome, ownershipShareFor(total, account.owner, person.id));
      }
      let savingsTax = zeroPence();
      if (savingsInterestIncome > 0) {
        const personalSavingsAllowance = determinePersonalSavingsAllowance(taxableIncomeSoFarForBands, fullBands, prepared.savingsAllowance);
        savingsTax = calculateSavingsTax(taxableIncomeSoFarForBands, savingsInterestIncome, personalSavingsAllowance, fullBands);
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, savingsInterestIncome);
      }

      let dividendIncome = zeroPence();
      for (const account of scenario.accounts) {
        if (account.kind !== "gia" || (account.owner !== person.id && account.owner !== "joint")) continue;
        const total = giaDividendByAccountId.get(account.id) ?? zeroPence();
        dividendIncome = addPence(dividendIncome, ownershipShareFor(total, account.owner, person.id));
      }
      let dividendTax = zeroPence();
      if (dividendIncome > 0) {
        dividendTax = calculateDividendTax(taxableIncomeSoFarForBands, dividendIncome, prepared.dividendTax.allowance, fullBands, prepared.dividendTax);
        taxableIncomeSoFarForBands = addPence(taxableIncomeSoFarForBands, dividendIncome);
      }

      // Rental profit and the mortgage interest credit add in gross here
      // (step 3 already folded rental profit's *tax* into `incomeTax`
      // above); property sale net proceeds are already net of any CGT
      // due, mirroring how `taxFreeIncome` adds in with no further tax
      // effect (SPEC.md §3.8).
      const netIncome = subtractPence(
        sumPence([
          pass1.grossIncome,
          pass1.rentalProfitIncome,
          drawdownNetAchieved,
          pass1.taxFreeIncome,
          pass1.mortgageInterestCredit,
          propertySaleNetProceeds,
        ]),
        sumPence([incomeTax, nationalInsurance, annualAllowanceCharge, pass1.otherExpenses, savingsTax, dividendTax]),
      );

      // 6c. Surplus cash sweep: any positive net income not otherwise
      //     directed by a contribution drain is automatically invested —
      //     into an ISA first (up to the remaining annual subscription
      //     limit), then a GIA for anything beyond that, rather than left
      //     untracked (this project's own priority order; SPEC.md §5.1
      //     step 7's default is a plain CashAccount). Uses this person's
      //     own ISA (which, unlike a GIA, can never be jointly held) or
      //     their own/a joint GIA, if any — v1 scope, matching every other
      //     multi-account mechanism in this engine; no sweep happens at
      //     all if they hold neither. Computed from this year's
      //     already-final net income, so swept money starts earning
      //     interest/dividends from next year, not this one.
      let surplusSweptToIsa = zeroPence();
      let surplusSweptToGia = zeroPence();
      if (netIncome > 0) {
        let surplusLeft = netIncome;
        const isaAccount = scenario.accounts.find((a): a is IsaAccount => a.kind === "isa" && a.owner === person.id);
        if (isaAccount) {
          const isaRoomRemaining = maxPence(subtractPence(prepared.isa.annualSubscriptionLimit, pass1.isaContributionsThisYear), zeroPence());
          surplusSweptToIsa = minPence(surplusLeft, isaRoomRemaining);
          if (surplusSweptToIsa > 0) {
            const currentBalance = nextAccountBalances.get(isaAccount.id) ?? zeroPence();
            nextAccountBalances.set(isaAccount.id, addPence(currentBalance, surplusSweptToIsa));
            surplusLeft = subtractPence(surplusLeft, surplusSweptToIsa);
          }
        }
        if (surplusLeft > 0) {
          const giaAccount = scenario.accounts.find(
            (a): a is GiaAccount => a.kind === "gia" && (a.owner === person.id || a.owner === "joint"),
          );
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

      return {
        personId: person.id,
        grossIncome: pass1.grossIncome,
        taxFreeIncome: pass1.taxFreeIncome,
        grossPensionContribution: pass1.grossPensionContribution,
        pensionInputAmount: pass1.pensionInputAmount,
        annualAllowanceCharge,
        incomeTax,
        incomeTaxByBand,
        marriageAllowanceGiven: marriageAllowanceGiven.get(person.id) ?? zeroPence(),
        marriageAllowanceReceived: marriageAllowanceReceived.get(person.id) ?? zeroPence(),
        nationalInsurance,
        otherExpenses: pass1.otherExpenses,
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
        rentalProfitIncome: pass1.rentalProfitIncome,
        mortgageInterestCredit: pass1.mortgageInterestCredit,
        propertySaleGain,
        propertySaleCapitalGainsTax,
        propertySalePrivateResidenceReliefApplied,
        propertySaleNetProceeds,
        netIncome,
        surplusSweptToIsa,
        surplusSweptToGia,
      };
    });

    // 7. Grow every account balance by its own (already-real) growth rate,
    //    net of any pension charge, after this year's contributions and
    //    drawdown withdrawals have already been applied above. A sold
    //    property's balance was already zeroed in the property-sale step,
    //    so growing it (by whatever rate) is a no-op.
    for (const account of scenario.accounts) {
      const balance = nextAccountBalances.get(account.id) ?? zeroPence();
      const netGrowthRate = account.kind === "pension" ? account.annualGrowthRate - account.annualChargeRate : account.annualGrowthRate;
      nextAccountBalances.set(account.id, growPenceByRate(balance, netGrowthRate));
    }

    accountBalances = nextAccountBalances;
    lumpSumAllowanceUsed = nextLumpSumAllowanceUsed;
    costBasisByAccountId = nextCostBasisByAccountId;
    nominalMortgageBalanceByPropertyId = nextNominalMortgageBalanceByPropertyId;
    carryForwardWindows = nextCarryForwardWindows;
    rows.push({
      taxYear,
      calendarYear,
      perPerson,
      accountBalances: new Map(accountBalances),
      costBasisByAccountId: new Map(costBasisByAccountId),
      mortgageBalanceByPropertyId: new Map(
        [...nominalMortgageBalanceByPropertyId].map(([propertyId, nominalBalance]) => [
          propertyId,
          deflateNominalAmount(nominalBalance, scenario.inflationRate, yearIndex),
        ]),
      ),
      survivorshipEvents,
    });
  }

  return { rows };
}

/** Total tax (Income Tax + NI + any Annual Allowance charge + any drawdown Income Tax/CGT + savings/dividend Income Tax + any property sale CGT, less the mortgage interest credit) across every person, for a given year's ledger row — a small convenience used by golden-file tests and the tax breakdown view. */
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
      p.propertySaleCapitalGainsTax,
      subtractPence(zeroPence(), p.mortgageInterestCredit),
    ]),
  );
}
