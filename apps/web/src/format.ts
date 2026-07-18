import { penceToPounds, type Pence } from "@fp/engine";

export function formatMoney(amount: Pence | undefined): string {
  if (amount === undefined) return "—";
  return `£${penceToPounds(amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(rate: number): string {
  return `${(rate * 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}
