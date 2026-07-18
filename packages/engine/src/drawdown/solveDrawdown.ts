import { addPence, dividePenceByRate, minPence, multiplyPenceByRate, subtractPence, zeroPence, type Pence } from "../money/pence.js";
import type { DrawdownBucket, TaxCategory } from "../catalog/types.js";
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
  /** Balance of a single uncrystallised pension account (v1 scope: one pension per person). */
  readonly pensionBalance: Pence;
  readonly lumpSumAllowanceRemaining: Pence;
  /** Balance of a single ISA account (v1 scope: one ISA per person). */
  readonly isaBalance: Pence;
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
  readonly lumpSumAllowanceUsed: Pence;
  readonly incomeTaxCost: Pence;
  readonly netAchieved: Pence;
  /** Capacity (pension balance + ISA balance) ran out before the target net amount was reached. */
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

/**
 * The retirement drawdown solver (SPEC.md §5.7.1, §5.7.3): given a
 * person's desired net income for the year and the current state of
 * their pension/ISA, works out where that money comes from at the
 * lowest tax cost — ascending order: pension income within the Personal
 * Allowance (0%, plus its automatic UFPLS tax-free share), then the ISA
 * (0%, but a finite wrapper worth preserving), then pension income
 * escalating through the basic/higher/additional rate bands.
 *
 * v1 scope: a single pension account and a single ISA account per
 * person (matching the schema today) — GIA/cash/property buckets,
 * household-combined optimisation (SPEC.md §5.7.4), and the
 * "crystallise fully at retirement" pot override are not yet supported.
 */
export function solveDrawdown(inputs: DrawdownSolverInputs): DrawdownSolverResult {
  let remainingNet = inputs.targetNetAmount;
  let pensionLeft = inputs.pensionBalance;
  let lsaLeft = inputs.lumpSumAllowanceRemaining;
  let isaLeft = inputs.isaBalance;

  const bucketTotals = new Map<DrawdownBucket, { amount: Pence; taxCost: Pence }>();
  const addToBucket = (bucket: DrawdownBucket, amount: Pence, taxCost: Pence) => {
    if (amount <= 0 && taxCost <= 0) return;
    const existing = bucketTotals.get(bucket) ?? { amount: zeroPence(), taxCost: zeroPence() };
    bucketTotals.set(bucket, { amount: addPence(existing.amount, amount), taxCost: addPence(existing.taxCost, taxCost) });
  };

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

  const [firstBand, ...laterBands] = inputs.bandHeadroom;

  // Step 1 (SPEC.md §5.7.3): pension income within the Personal Allowance.
  if (firstBand) {
    withdrawFromPensionAtBand(firstBand);
  }

  // Step 2: the ISA — pure tax-free, preferred ahead of pushing pension withdrawals into a taxed band.
  if (remainingNet > 0 && isaLeft > 0) {
    const used = minPence(isaLeft, remainingNet);
    addToBucket("taxFreeISA", used, zeroPence());
    isaLeft = subtractPence(isaLeft, used);
    remainingNet = subtractPence(remainingNet, used);
  }

  // Steps 3+: escalate through the remaining taxed bands.
  for (const band of laterBands) {
    withdrawFromPensionAtBand(band);
  }

  const buckets: DrawdownBucketAmount[] = [...bucketTotals.entries()].map(([bucket, { amount, taxCost }]) => ({
    bucket,
    amount,
    taxCategory: bucket === "taxFreeISA" || bucket === "taxFreePensionLumpSum" ? "taxFree" : "pensionIncome",
    taxCost,
  }));

  const pensionGrossWithdrawn = subtractPence(inputs.pensionBalance, pensionLeft);
  const isaGrossWithdrawn = subtractPence(inputs.isaBalance, isaLeft);
  const lumpSumAllowanceUsed = subtractPence(inputs.lumpSumAllowanceRemaining, lsaLeft);
  const incomeTaxCost = buckets.reduce((total, b) => addPence(total, b.taxCost), zeroPence());
  const netAchieved = buckets.reduce((total, b) => addPence(total, subtractPence(b.amount, b.taxCost)), zeroPence());

  return {
    buckets,
    pensionGrossWithdrawn,
    isaGrossWithdrawn,
    lumpSumAllowanceUsed,
    incomeTaxCost,
    netAchieved,
    shortfall: remainingNet > 0,
  };
}
