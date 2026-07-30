import { HISTORICAL_RETURNS, HISTORICAL_RETURNS_SOURCES } from "./data.js";
import { US_EQUITY_RETURNS, US_EQUITY_RETURNS_SOURCES } from "./usEquityReturns.js";
import type { HistoricalReturnMonth, UsEquityReturnMonth } from "./types.js";

export function listHistoricalReturns(): readonly HistoricalReturnMonth[] {
  return HISTORICAL_RETURNS;
}

export function listHistoricalReturnsSources(): readonly { readonly description: string; readonly url: string }[] {
  return HISTORICAL_RETURNS_SOURCES;
}

export function listUsEquityReturns(): readonly UsEquityReturnMonth[] {
  return US_EQUITY_RETURNS;
}

export function listUsEquityReturnsSources(): readonly { readonly description: string; readonly url: string }[] {
  return US_EQUITY_RETURNS_SOURCES;
}
