import { describe, expect, it } from "vitest";
import { poundsToPence, zeroPence } from "../money/pence.js";
import { buildFullBandStack } from "./incomeTax.js";
import { calculateDividendTax, type DividendRates } from "./dividendTax.js";

const standardBands = [
  { name: "basic", upTo: poundsToPence(50270), rate: 0.2 },
  { name: "higher", upTo: poundsToPence(125140), rate: 0.4 },
  { name: "additional", upTo: null, rate: 0.45 },
];
const fullAllowance = poundsToPence(12570);
const fullBands = buildFullBandStack(fullAllowance, standardBands);

const dividendRates: DividendRates = { basicRate: 0.0875, higherRate: 0.3375, additionalRate: 0.3935 };
const dividendAllowance = poundsToPence(500);

describe("calculateDividendTax", () => {
  it("charges nothing when dividends are fully within the Dividend Allowance", () => {
    const tax = calculateDividendTax(poundsToPence(40000), poundsToPence(500), dividendAllowance, fullBands, dividendRates);
    expect(tax).toBe(0);
  });

  it("charges the basic dividend rate on the amount above the allowance", () => {
    const tax = calculateDividendTax(poundsToPence(40000), poundsToPence(1500), dividendAllowance, fullBands, dividendRates);
    expect(tax).toBe(poundsToPence(1000 * 0.0875));
  });

  it("charges the higher dividend rate for a higher-rate taxpayer, using dividend rates not standard Income Tax rates", () => {
    const tax = calculateDividendTax(poundsToPence(80000), poundsToPence(1500), dividendAllowance, fullBands, dividendRates);
    // £1,000 taxable at 33.75% — very different from the 40% standard higher rate, proving the dividend-specific rate schedule is actually used.
    expect(tax).toBe(poundsToPence(1000 * 0.3375));
    expect(tax).not.toBe(poundsToPence(1000 * 0.4));
  });

  it("charges the additional dividend rate when other income already exceeds every finite band", () => {
    const tax = calculateDividendTax(poundsToPence(200000), poundsToPence(1500), dividendAllowance, fullBands, dividendRates);
    expect(tax).toBe(poundsToPence(1000 * 0.3935));
  });

  it("splits taxable dividends across two rate bands when they straddle a boundary", () => {
    // Other income leaves exactly £500 of basic-band headroom; £2,000 dividends, £500 allowance:
    // allowance covers the first £500 (0%, within remaining basic headroom); remaining £1,500 taxable, all at higher dividend rate.
    const otherIncome = poundsToPence(49770);
    const tax = calculateDividendTax(otherIncome, poundsToPence(2000), dividendAllowance, fullBands, dividendRates);
    expect(tax).toBe(poundsToPence(1500 * 0.3375));
  });

  it("returns zero for zero dividend income", () => {
    expect(calculateDividendTax(poundsToPence(40000), zeroPence(), dividendAllowance, fullBands, dividendRates)).toBe(0);
  });
});
