/**
 * Query-parameter shapes for every endpoint.
 *
 * Every field is optional unless the API rejects the request without it. Fields
 * left `undefined` are omitted from the query string entirely, so the server's own
 * default applies.
 *
 * @module
 */

/** Preset orderings for the discovery feed. */
export type DiscoverTab = 'trending' | 'new' | 'gainers' | 'graduating';

/** Bonding-curve lifecycle filter. `bonding` = still on the curve, `graduated` = has a DEX pair. */
export type TokenStatus = 'bonding' | 'graduated';

/** Sort direction for {@link ListTokensParams.orderFlag}. */
export type SortDirection = 'asc' | 'desc';

/** Query parameters for `GET /discover`. */
export interface DiscoverParams {
  /** Preset ordering. Omit for the server default. */
  tab?: DiscoverTab;
  /** Chain slug, currently always `"bsc"`. */
  network?: string;
  /** Minimum USD market cap. */
  minMarketcap?: number;
  /** Minimum 24h USD volume. */
  minVolume?: number;
  /** Minimum holder count. */
  minHolders?: number;
  /** Only tokens created within this many seconds. */
  maxAgeSecs?: number;
  /** Curve-lifecycle filter. */
  status?: TokenStatus;
  /** Rows to return. Server default 50. */
  limit?: number;
}

/** Query parameters for `GET /tokens`. */
export interface ListTokensParams {
  /** Field to sort by, e.g. `"marketcap"`, `"createdAt"`, `"score"`. */
  orderType?: string;
  /** Sort direction. */
  orderFlag?: SortDirection;
  /** Free-text match on name, symbol or address. */
  searchWord?: string;
  /** Chain slug, currently always `"bsc"`. */
  network?: string;
  /** Exact-match filter on generated image style (`"all"` = no filter). */
  style?: string;
  /** Include tokens flagged NSFW. */
  includeNsfw?: boolean;
  /** 1-based page number. Server default 1. */
  pageNumber?: number;
  /** Rows per page. Clamped by the server to 1-100; asking for more returns 100. */
  pageSize?: number;
}

/** Pagination for the trades embedded in `GET /tokens/{network}/{tokenAddress}`. */
export interface TokenDetailParams {
  /** 1-based page number for the embedded trade list. Server default 1. */
  pageNumber?: number;
  /** Trades per page. Server default 20. */
  pageSize?: number;
}

/** Query parameters for `GET /trades/recent`. */
export interface RecentTradesParams {
  /** Return only trades with an id greater than this — use it to poll incrementally. */
  latestTradeId?: number;
  /** Return only tokens with an id greater than this. */
  latestTokenId?: number;
}

/** Query parameters for `POST /trades`. */
export interface TokenTradesParams {
  /** Rows to return. Server default 50. */
  limit?: number;
  /** Rows to skip. Server default 0. */
  offset?: number;
}

/** Query parameters for `GET /trades/getChartData`. All four required ones must be supplied. */
export interface ChartDataParams {
  /** Token contract address. Required. */
  tokenAddress: string;
  /** Candle width: `"1"`, `"5"`, `"15"`, `"60"`, `"1D"` — minutes unless suffixed. Required. */
  interval: string;
  /** Range start, UNIX **seconds**. Required. */
  from: number;
  /** Range end, UNIX **seconds**. Required. */
  to: number;
  /** TradingView `firstDataRequest` flag, passed through as-is. */
  first?: number;
  /** Restrict to a specific DEX. */
  dex?: string;
  /** Number of candles to return, ending at {@link ChartDataParams.to}. */
  countBack?: number;
}

/** Query parameters for the user and referral leaderboards. */
export interface LeaderboardParams {
  /** Rows to return. Server default 100, clamped by the server to 1-500. */
  limit?: number;
}

/** Query parameters for `GET /users/top/{count}`. */
export interface TopHoldersParams {
  /** Window start, UNIX **seconds**. Server default 0 (all time). */
  from?: number;
  /** Window end, UNIX **seconds**. Defaults to unbounded. */
  to?: number;
  /** Only count volume on this chain. */
  network?: string;
}

/** Query parameters for `GET /distributor/shares`. */
export interface SharesParams {
  /** Window start, UNIX **seconds**. Defaults to the end of the last paid round. */
  from?: number;
  /** Window end, UNIX **seconds**. Defaults to now. Must be after `from` or the API returns 400. */
  to?: number;
  /** Max holders, top-N by points. Server default 100, clamped to 1-100 (the contract's `MAX_HOLDERS`). */
  limit?: number;
}

/** Query parameters for `GET /distributor/rounds`. */
export interface ListRoundsParams {
  /** Rows to return. Server default 25, clamped by the server to 1-100. */
  limit?: number;
  /** Rows to skip. Server default 0. */
  offset?: number;
}
