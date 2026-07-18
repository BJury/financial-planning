import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { buildFullBandStack, computeRemainingBandHeadroom } from "./incomeTax.js";
import { taxStackedIncomeWithAllowance } from "./stackedAllowanceIncome.js";

const standardBands = [
  { name: "basic", upTo: poundsToPence(50270), rate: 0.2 },
  { name: "higher", upTo: poundsToPence(125140), rate: 0.4 },
  { name: "additional", upTo: null, rate: 0.45 },
];
const fullAllowance = poundsToPence(12570);
const fullBands = buildFullBandStack(fullAllowance, standardBands);
const rateForBand = (name: string) => fullBands.find((b) => b.name === name)?.rate ?? 0;

describe("taxStackedIncomeWithAllowance", () => {
  it("charges nothing when the allowance fully covers the income", () => {
    const headroom = computeRemainingBandHeadroom(fullBands, zeroPence());
    const tax = taxStackedIncomeWithAllowance(poundsToPence(1000), poundsToPence(1000), headroom, rateForBand);
    expect(tax).toBe(0);
  });

  it("taxes only the amount above the allowance, at the marginal rate", () => {
    // Other income already fills the PA exactly; £2,000 of stacked income, £1,000 allowance -> £1,000 taxable at basic rate (20%).
    const headroom = computeRemainingBandHeadroom(fullBands, fullAllowance);
    const tax = taxStackedIncomeWithAllowance(poundsToPence(2000), poundsToPence(1000), headroom, rateForBand);
    expect(tax).toBe(poundsToPence(1000 * 0.2));
  });

  it("the allowance itself still occupies band space even though it's untaxed", () => {
    // Other income leaves exactly £500 of basic-band headroom (basic
    // band's cumulative ceiling is £50,270; £50,270 - £500 = £49,770).
    // A £1,000 allowance + £2,000 income: the allowance covers the
    // remaining £500 of basic headroom (0%, as normal) *and* spills into
    // the next £500 of the higher band (still 0%, since it's the
    // allowance) — occupying band space without generating tax. Only the
    // remaining £1,000 of income is actually taxable, at the higher rate.
    const otherIncome = poundsToPence(49770);
    const headroom = computeRemainingBandHeadroom(fullBands, otherIncome);
    const tax = taxStackedIncomeWithAllowance(poundsToPence(2000), poundsToPence(1000), headroom, rateForBand);
    expect(tax).toBe(poundsToPence(1000 * 0.4));
  });

  it("splits taxable income across bands correctly when it straddles a boundary", () => {
    // No allowance, no other income: £51,000 stacked income spans PA (£12,570 @ 0%),
    // basic (£37,700 @ 20%), and £730 into higher (40%).
    const headroom = computeRemainingBandHeadroom(fullBands, zeroPence());
    const tax = taxStackedIncomeWithAllowance(poundsToPence(51000), zeroPence(), headroom, rateForBand);
    const expected = poundsToPence(37700 * 0.2) + poundsToPence(730 * 0.4);
    expect(tax).toBe(expected);
  });

  it("taxes entirely within the unbounded top band when other income already exceeds every finite ceiling", () => {
    const headroom = computeRemainingBandHeadroom(fullBands, poundsToPence(200000));
    const tax = taxStackedIncomeWithAllowance(poundsToPence(10000), zeroPence(), headroom, rateForBand);
    expect(tax).toBe(poundsToPence(10000 * 0.45));
  });

  it("returns zero for zero income", () => {
    const headroom = computeRemainingBandHeadroom(fullBands, zeroPence());
    expect(taxStackedIncomeWithAllowance(zeroPence(), poundsToPence(1000), headroom, rateForBand)).toBe(0);
  });

  it("supports a custom rate schedule distinct from the bands' own rates (e.g. dividend rates)", () => {
    const dividendRateForBand = (name: string) => {
      if (name === "basic") return 0.0875;
      if (name === "higher") return 0.3375;
      if (name === "additional") return 0.3935;
      return 0;
    };
    const headroom = computeRemainingBandHeadroom(fullBands, fullAllowance); // PA exactly filled
    const tax = taxStackedIncomeWithAllowance(poundsToPence(1000), zeroPence(), headroom, dividendRateForBand);
    expect(tax).toBe(poundsToPence(1000 * 0.0875));
  });
});
