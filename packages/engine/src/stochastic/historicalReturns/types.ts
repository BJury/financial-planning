/**
 * One calendar month's *real* (inflation-adjusted) monthly return for
 * three bundled asset classes (UK equities, bonds, cash) — already
 * deflated, never mutate or re-derive in place (same convention as
 * `taxYearData/types.ts`). US equities live in a separate, much
 * longer-running table (`usEquityReturns.ts`'s `UsEquityReturnMonth`) —
 * see that file's doc comment for why the two don't share one window.
 */
export interface HistoricalReturnMonth {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly ukEquities: number;
  readonly bonds: number;
  readonly cash: number;
}

/** One calendar month's *real* (inflation-adjusted) monthly return for US equities — see `usEquityReturns.ts`'s `US_EQUITY_RETURNS` doc comment. */
export interface UsEquityReturnMonth {
  readonly year: number;
  /** 1-12. */
  readonly month: number;
  readonly usEquities: number;
}
