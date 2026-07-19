import { addPence, dividePenceByRate, minPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";
import type { DrawdownBucket, TaxCategory } from "../catalog/types.js";
import type { CapitalGainsRates } from "../tax/capitalGainsTax.js";
import { splitGiaWithdrawal } from "../tax/giaWithdrawalSplit.js";
import type { RemainingBandHeadroom } from "../tax/incomeTax.js";
import { splitUfplsWithdrawal } from "../tax/pensionLumpSum.js";

export interface DrawdownSolverInputs {
  /** How much net (after-tax) income this person wants this year (SPEC.md §5.7.1) — what's actually left to source once any automatic income is netted off. */
  readonly targetNetAmount: Pence;
  /**
   * This person's remaining Income Tax band headroom for the year, in
   * ascending marginal-rate order (Personal Allowance, basic, higher,
   * additional), after any other income already earned this year — see
   * `computeRemainingBandHeadroom` in tax/incomeTax.ts.
   */
  readonly bandHeadroom: readonly RemainingBandHeadroom[];
  /**
   * Uncrystallised pension balance — the *pooled* total across every
   * pension account this draw applies to, not necessarily just one
   * (`simulation/runProjection.ts` sums a person's own pension accounts
   * before calling this and apportions the resulting withdrawal back
   * across them pro-rata by balance; this solver itself only ever deals
   * in a single scalar).
   */
  readonly pensionBalance: Pence;
  readonly lumpSumAllowanceRemaining: Pence;
  /** Pooled ISA balance — see `pensionBalance`'s note on pooling. */
  readonly isaBalance: Pence;
  /** Pooled cash balance — see `pensionBalance`'s note on pooling. */
  readonly cashBalance: Pence;
  /** Pooled GIA balance — see `pensionBalance`'s note on pooling. */
  readonly giaBalance: Pence;
  readonly giaCostBasis: Pence;
  /** This person's remaining CGT Annual Exempt Amount for the year — an *annual* allowance (unlike the LSA), so callers never carry this across years. */
  readonly capitalGainsExemptAmountRemaining: Pence;
  readonly capitalGainsRates: CapitalGainsRates;
}

export interface DrawdownBucketAmount {
  readonly bucket: DrawdownBucket;
  readonly amount: Pence;
  readonly taxCategory: TaxCategory;
  readonly taxCost: Pence;
}

export interface DrawdownSolverResult {
  readonly buckets: readonly DrawdownBucketAmount[];
  readonly pensionGrossWithdrawn: Pence;
  readonly isaGrossWithdrawn: Pence;
  readonly cashGrossWithdrawn: Pence;
  readonly giaGrossWithdrawn: Pence;
  readonly lumpSumAllowanceUsed: Pence;
  readonly capitalGainsExemptAmountUsed: Pence;
  /** Income Tax only — pension income. */
  readonly incomeTaxCost: Pence;
  /** CGT only — kept separate from Income Tax since it's a different tax entirely. */
  readonly capitalGainsTaxCost: Pence;
  readonly netAchieved: Pence;
  /** Capacity (pension + ISA + cash + GIA balances) ran out before the target net amount was reached. */
  readonly shortfall: boolean;
}

function bucketForBandName(name: string): DrawdownBucket {
  switch (name) {
    case "personalAllowance":
      return "taxablePersonalAllowance";
    case "basic":
      return "taxableBasicRate";
    case "higher":
      return "taxableHigherRate";
    default:
      return "taxableAdditionalRate";
  }
}

function taxCategoryForBucket(bucket: DrawdownBucket): TaxCategory {
  if (bucket === "capitalGainWithinAllowance" || bucket === "capitalGainTaxable") return "capitalGain";
  if (bucket === "taxFreeISA" || bucket === "taxFreePensionLumpSum" || bucket === "taxFreeCashPrincipal" || bucket === "taxFreeGIAReturnOfCapital") {
    return "taxFree";
  }
  return "pensionIncome";
}

/** A CGT rate has only two tiers (basic/higher) — "additional" Income Tax band still pays the CGT higher rate (SPEC.md §5.5). */
function cgtRateForBand(bandName: string, rates: CapitalGainsRates): number {
  return bandName === "basic" ? rates.basicRate : rates.higherRate;
}

/**
 * The retirement drawdown solver (SPEC.md §5.7.1, §5.7.3): given a
 * person's desired net income for the year and the current state of
 * their accounts, works out where that money comes from at the lowest
 * tax cost. Ascending order: pension income within the Personal
 * Allowance (0%, plus its automatic UFPLS tax-free share — always the
 * best value, so it goes first unconditionally); then the "free" tier —
 * ISA, cash principal, and GIA withdrawals whose gain stays within the
 * CGT Annual Exempt Amount (all 0% cost); then, escalating through the
 * basic/higher/additional Income Tax bands, a per-band comparison
 * between pension income (Income Tax) and further GIA withdrawals
 * (CGT) — whichever currently nets more per pound drawn goes first.
 *
 * That per-band comparison is a *simplification* of SPEC.md §5.7.3's
 * "prefer whichever is cheaper for the next £ needed": it compares once
 * per band using pension's best available rate at that band (UFPLS if
 * the Lump Sum Allowance remains, else fully taxable), not continuously
 * re-compared pound-by-pound as pension's own rate shifts mid-band —
 * correct in the common case (UFPLS's guaranteed 25% tax-free share
 * usually wins), but not perfectly optimal in every edge case.
 *
 * Operates on already-pooled balances (see `pensionBalance`'s doc
 * comment) — property, and the "crystallise fully at retirement" pot
 * override aren't supported yet.
 */
export function solveDrawdown(inputs: DrawdownSolverInputs): DrawdownSolverResult {
  let remainingNet = inputs.targetNetAmount;
  let pensionLeft = inputs.pensionBalance;
  let lsaLeft = inputs.lumpSumAllowanceRemaining;
  let isaLeft = inputs.isaBalance;
  let cashLeft = inputs.cashBalance;
  let giaBalanceLeft = inputs.giaBalance;
  let giaCostBasisLeft = inputs.giaCostBasis;
  let aeaLeft = inputs.capitalGainsExemptAmountRemaining;

  const bucketTotals = new Map<DrawdownBucket, { amount: Pence; taxCost: Pence }>();
  const addToBucket = (bucket: DrawdownBucket, amount: Pence, taxCost: Pence) => {
    if (amount <= 0 && taxCost <= 0) return;
    const existing = bucketTotals.get(bucket) ?? { amount: zeroPence(), taxCost: zeroPence() };
    bucketTotals.set(bucket, { amount: addPence(existing.amount, amount), taxCost: addPence(existing.taxCost, taxCost) });
  };

  const giaGainFraction = (): number => (giaBalanceLeft > 0 ? Math.max(0, (giaBalanceLeft - giaCostBasisLeft) / giaBalanceLeft) : 0);

  const withdrawFromPensionAtBand = (band: RemainingBandHeadroom) => {
    if (remainingNet <= 0 || pensionLeft <= 0) return;
    const taxableBucket = bucketForBandName(band.name);
    let bandWidthLeft = band.remainingWidth;

    // Sub-step A: the UFPLS-ratio portion, while Lump Sum Allowance remains — always the best value at any band, since it comes with a bonus tax-free share on top of the band's own rate.
    if (lsaLeft > 0) {
      const netPerGrossUfpls = 0.25 + 0.75 * (1 - band.rate);
      let grossCap = minPence(pensionLeft, dividePenceByRate(lsaLeft, 0.25));
      if (bandWidthLeft !== null) {
        grossCap = minPence(grossCap, dividePenceByRate(bandWidthLeft, 0.75));
      }
      const grossUsed = minPence(grossCap, dividePenceByRate(remainingNet, netPerGrossUfpls));

      if (grossUsed > 0) {
        const split = splitUfplsWithdrawal(grossUsed, lsaLeft);
        const tax = multiplyPenceByRate(split.taxableAmount, band.rate);
        const net = subtractPence(addPence(split.taxFreeAmount, split.taxableAmount), tax);

        addToBucket("taxFreePensionLumpSum", split.taxFreeAmount, zeroPence());
        addToBucket(taxableBucket, split.taxableAmount, tax);

        pensionLeft = subtractPence(pensionLeft, grossUsed);
        lsaLeft = subtractPence(lsaLeft, split.lumpSumAllowanceUsed);
        remainingNet = subtractPence(remainingNet, net);
        if (bandWidthLeft !== null) {
          bandWidthLeft = subtractPence(bandWidthLeft, split.taxableAmount);
        }
      }
    }

    // Sub-step B: fully-taxable portion, once the Lump Sum Allowance is exhausted (or for whatever this band has left after sub-step A).
    if (remainingNet > 0 && pensionLeft > 0 && (bandWidthLeft === null || bandWidthLeft > 0)) {
      const netPerGrossFull = 1 - band.rate;
      let grossCap = pensionLeft;
      if (bandWidthLeft !== null) {
        grossCap = minPence(grossCap, bandWidthLeft);
      }
      const grossUsed = minPence(grossCap, dividePenceByRate(remainingNet, netPerGrossFull));

      if (grossUsed > 0) {
        const tax = multiplyPenceByRate(grossUsed, band.rate);
        addToBucket(taxableBucket, grossUsed, tax);
        pensionLeft = subtractPence(pensionLeft, grossUsed);
        remainingNet = subtractPence(remainingNet, subtractPence(grossUsed, tax));
      }
    }
  };

  const applyGiaWithdrawal = (grossUsed: Pence, gainTax: Pence, gainBucket: DrawdownBucket) => {
    const split = splitGiaWithdrawal(grossUsed, giaCostBasisLeft, giaBalanceLeft);
    addToBucket("taxFreeGIAReturnOfCapital", split.returnOfCapitalAmount, zeroPence());
    addToBucket(gainBucket, split.gainAmount, gainTax);
    giaBalanceLeft = subtractPence(giaBalanceLeft, grossUsed);
    giaCostBasisLeft = subtractPence(giaCostBasisLeft, split.returnOfCapitalAmount);
    remainingNet = subtractPence(remainingNet, subtractPence(grossUsed, gainTax));
  };

  // The "free" GIA tier — draw as much as possible while the gain
  // portion stays within the remaining CGT Annual Exempt Amount (0% cost,
  // same tier as ISA/cash).
  const withdrawFromGiaWithinAea = () => {
    if (remainingNet <= 0 || giaBalanceLeft <= 0) return;
    const gainFraction = giaGainFraction();
    let grossCap = giaBalanceLeft;
    if (gainFraction > 0) {
      grossCap = minPence(grossCap, dividePenceByRate(aeaLeft, gainFraction));
    }
    const grossUsed = minPence(grossCap, remainingNet); // netPerGross is 1 here — nothing is taxed
    if (grossUsed <= 0) return;
    const gainPortion = multiplyPenceByRate(grossUsed, gainFraction);
    aeaLeft = subtractPence(aeaLeft, gainPortion);
    applyGiaWithdrawal(grossUsed, zeroPence(), "capitalGainWithinAllowance");
  };

  // GIA beyond the AEA — the gain portion is taxed at `rate`.
  const withdrawFromGiaTaxable = (rate: number) => {
    if (remainingNet <= 0 || giaBalanceLeft <= 0) return;
    const gainFraction = giaGainFraction();
    const netPerGross = 1 - gainFraction * rate;
    const grossUsed = minPence(giaBalanceLeft, dividePenceByRate(remainingNet, netPerGross));
    if (grossUsed <= 0) return;
    const gainPortion = multiplyPenceByRate(grossUsed, gainFraction);
    const tax = multiplyPenceByRate(gainPortion, rate);
    applyGiaWithdrawal(grossUsed, tax, "capitalGainTaxable");
  };

  const [firstBand, ...laterBands] = inputs.bandHeadroom;

  // Step 1 (SPEC.md §5.7.3): pension income within the Personal Allowance — unconditionally first, since UFPLS's bonus tax-free share beats any alternative here.
  if (firstBand) {
    withdrawFromPensionAtBand(firstBand);
  }

  // Step 2: the free tier — ISA, cash principal, then GIA within the CGT Annual Exempt Amount.
  if (remainingNet > 0 && isaLeft > 0) {
    const used = minPence(isaLeft, remainingNet);
    addToBucket("taxFreeISA", used, zeroPence());
    isaLeft = subtractPence(isaLeft, used);
    remainingNet = subtractPence(remainingNet, used);
  }
  if (remainingNet > 0 && cashLeft > 0) {
    const used = minPence(cashLeft, remainingNet);
    addToBucket("taxFreeCashPrincipal", used, zeroPence());
    cashLeft = subtractPence(cashLeft, used);
    remainingNet = subtractPence(remainingNet, used);
  }
  withdrawFromGiaWithinAea();

  // Steps 3+: escalate through the remaining taxed bands, comparing
  // pension (Income Tax) against further GIA withdrawals (CGT) at each
  // band and preferring whichever currently nets more per pound.
  for (const band of laterBands) {
    if (remainingNet <= 0) break;

    const rate = cgtRateForBand(band.name, inputs.capitalGainsRates);
    const pensionNetPerGross = lsaLeft > 0 ? 0.25 + 0.75 * (1 - band.rate) : 1 - band.rate;
    const giaNetPerGross = giaBalanceLeft > 0 ? 1 - giaGainFraction() * rate : -1;

    if (giaBalanceLeft > 0 && giaNetPerGross > pensionNetPerGross) {
      withdrawFromGiaTaxable(rate);
      withdrawFromPensionAtBand(band);
    } else {
      withdrawFromPensionAtBand(band);
      if (remainingNet > 0) withdrawFromGiaTaxable(rate);
    }
  }

  const buckets: DrawdownBucketAmount[] = [...bucketTotals.entries()].map(([bucket, { amount, taxCost }]) => ({
    bucket,
    amount,
    taxCategory: taxCategoryForBucket(bucket),
    taxCost,
  }));

  const pensionGrossWithdrawn = subtractPence(inputs.pensionBalance, pensionLeft);
  const isaGrossWithdrawn = subtractPence(inputs.isaBalance, isaLeft);
  const cashGrossWithdrawn = subtractPence(inputs.cashBalance, cashLeft);
  const giaGrossWithdrawn = subtractPence(inputs.giaBalance, giaBalanceLeft);
  const lumpSumAllowanceUsed = subtractPence(inputs.lumpSumAllowanceRemaining, lsaLeft);
  const capitalGainsExemptAmountUsed = subtractPence(inputs.capitalGainsExemptAmountRemaining, aeaLeft);
  const incomeTaxCost = buckets.filter((b) => b.taxCategory === "pensionIncome").reduce((total, b) => addPence(total, b.taxCost), zeroPence());
  const capitalGainsTaxCost = buckets.filter((b) => b.taxCategory === "capitalGain").reduce((total, b) => addPence(total, b.taxCost), zeroPence());
  const netAchieved = buckets.reduce((total, b) => addPence(total, subtractPence(b.amount, b.taxCost)), zeroPence());

  return {
    buckets,
    pensionGrossWithdrawn,
    isaGrossWithdrawn,
    cashGrossWithdrawn,
    giaGrossWithdrawn,
    lumpSumAllowanceUsed,
    capitalGainsExemptAmountUsed,
    incomeTaxCost,
    capitalGainsTaxCost,
    netAchieved,
    shortfall: remainingNet > 0,
  };
}
