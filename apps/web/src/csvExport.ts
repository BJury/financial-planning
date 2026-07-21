import { addPence, penceToPounds, subtractPence, sumPence, type Pence, type ProjectionResult } from "@fp/engine";
import { computeNetWorth } from "./projection.js";

const COLUMNS = [
  "Tax year",
  "Person",
  "Gross income",
  "Rental profit",
  "State Pension income",
  "Drawdown net achieved",
  "Income Tax",
  "National Insurance",
  "Capital Gains Tax",
  "Dividend tax",
  "Savings tax",
  "Annual Allowance charge",
  "Mortgage interest credit",
  "Property sale net proceeds",
  "Shortfall funded from savings",
  "Net income",
  "Unallocated surplus",
  "Household net worth",
] as const;

function money(amount: Pence): string {
  return penceToPounds(amount).toFixed(2);
}

/**
 * A field is quoted only if it needs to be (SPEC.md doesn't require RFC
 * 4180 strictness here, but every value in this export is either a
 * number or one of a small, known set of labels — quoting defensively
 * costs nothing and avoids ever mis-parsing a value containing a comma).
 */
function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The full year-by-year projection as CSV (SPEC.md §4 journey 7's
 * "Export report") — one row per person per year, since tax is
 * calculated per person (SPEC.md §5.1), plus the household's combined
 * net worth repeated on each of that year's rows for convenience. A
 * read-only report for sharing/printing/spreadsheet analysis, distinct
 * from "Save to file" (the re-importable Scenario *input* data).
 */
export function projectionToCsv(result: ProjectionResult): string {
  const lines: string[] = [COLUMNS.join(",")];

  for (const row of result.rows) {
    const netWorth = money(computeNetWorth(row));
    for (const [index, person] of row.perPerson.entries()) {
      const label = row.perPerson.length > 1 ? (index === 0 ? "Person 1" : "Person 2") : "";
      // Deliberately *not* `person.netIncome` — that engine field is
      // further reduced by living expenses/contributions and by
      // auto-consumption (achieving a drawdown target counts as spent,
      // SPEC.md §5.7.2), so it usually settles at/near £0 and doesn't
      // answer "how much came in this year". Same recomputation as the
      // year-by-year table's own "Net income" column and the projection
      // chart's own "Net income" line (ProjectionResults.tsx), narrowed
      // to this one person instead of summed across the household —
      // kept in sync with both by hand, no shared helper exists yet.
      const netIncome = subtractPence(
        sumPence([
          person.grossIncome,
          person.rentalProfitIncome,
          person.statePensionIncome,
          person.drawdownNetAchieved,
          person.taxFreeIncome,
          person.mortgageInterestCredit,
          person.propertySaleNetProceeds,
        ]),
        sumPence([person.incomeTax, person.nationalInsurance, person.annualAllowanceCharge, person.savingsTax, person.dividendTax]),
      );
      lines.push(
        [
          row.taxYear,
          label,
          money(person.grossIncome),
          money(person.rentalProfitIncome),
          money(person.statePensionIncome),
          money(person.drawdownNetAchieved),
          money(addPence(person.incomeTax, person.drawdownIncomeTax)),
          money(person.nationalInsurance),
          money(sumPence([person.drawdownCapitalGainsTax, person.propertySaleCapitalGainsTax, person.shortfallCapitalGainsTax])),
          money(person.dividendTax),
          money(person.savingsTax),
          money(person.annualAllowanceCharge),
          money(person.mortgageInterestCredit),
          money(person.propertySaleNetProceeds),
          money(person.shortfallFundedFromSavings),
          money(netIncome),
          money(person.unallocatedSurplus),
          netWorth,
        ]
          .map((field) => csvField(field))
          .join(","),
      );
    }
  }

  return lines.join("\r\n");
}

export function downloadCsv(csv: string, filename = "retirement-projection.csv"): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
