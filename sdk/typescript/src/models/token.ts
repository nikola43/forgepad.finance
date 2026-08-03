/**
 * Token, holder and discovery wire types.
 *
 * ## Decimal strings
 *
 * Every monetary/amount field on {@link Token}, {@link Holder} and
 * {@link TokenDetail} is a **decimal string**, not a number. Token amounts carry
 * 18 decimals and market caps routinely exceed what an IEEE-754 double can hold
 * exactly. Keep them as strings, compare them as strings, and only convert with a
 * big-decimal library at the very last moment (display, or arithmetic you control
 * the rounding of). `Number(token.marketcap)` silently loses precision.
 *
 * @module
 */

import type { CreatorInfo } from './common.js';
import type { Trade } from './trade.js';

/**
 * Full token record, including bonding-curve virtual reserves.
 *
 * A Fyuz token trades on an internal bonding curve until it reaches a $30,000
 * market cap, at which point it *graduates* into a PancakeSwap V2 pair. Before
 * graduation {@link Token.pairAddress} is `null` and no DEX pool exists anywhere —
 * this API is the only source of price for such a token.
 */
export interface Token {
  /** Internal numeric id. Stable, but prefer {@link Token.tokenAddress} as the key. */
  id: number;
  /** ERC-20 contract address. */
  tokenAddress: string;
  tokenName: string;
  tokenSymbol: string;
  tokenDescription: string | null;
  /** Generated-image style tag, e.g. `"pixel"`. `null` for uploaded images. */
  imageStyle: string | null;
  tokenImage: string | null;
  tokenBanner: string | null;
  /** Address that launched the token. */
  creatorAddress: string;
  /** Profile stub for {@link Token.creatorAddress}. */
  user: CreatorInfo;
  /** Chain slug, currently always `"bsc"`. */
  network: string;
  /** USD market cap. Decimal string — do not parse as a float. */
  marketcap: string;
  /** Token price in USD. Decimal string. */
  price: string;
  /** BNB price in USD at the last update. Decimal string. */
  ethPrice: string;
  /** Cumulative USD volume. Decimal string. */
  volume: string;
  /** Internal ranking score used by the `score` sort. Decimal string. */
  score: string;
  /** Bonding-curve virtual BNB reserve. Decimal string. */
  virtualEthAmount: string;
  /** Bonding-curve virtual token reserve. Decimal string. */
  virtualTokenAmount: string;
  /**
   * PancakeSwap pair address.
   *
   * `null` while the token is still on the bonding curve — there is no DEX pool
   * to look up, and this API is the only price source.
   */
  pairAddress: string | null;
  /**
   * Pool flavour: `1` = PancakeSwap V2, `2` = V3, `3` = V4 / direct launch.
   *
   * Typed as `number` rather than a literal union because the backend can emit
   * values the published documentation does not enumerate.
   */
  poolType: number;
  category: string;
  /** Number of comments on the token page. */
  replies: number;
  webLink: string | null;
  telegramLink: string | null;
  twitterLink: string | null;
  /**
   * Graduation timestamp, RFC-3339. `null` means the token has not graduated
   * and is still trading on the curve.
   */
  launchedAt: string | null;
  /** RFC-3339 timestamp. */
  createdAt: string;
  /** RFC-3339 timestamp. */
  updatedAt: string;
  /** RFC-3339 timestamp of the on-chain creation. */
  creationTime: string;
  /** USD liquidity. Decimal string, or `null` when unknown. */
  liquidity: string | null;
  /** Graduation progress toward the $30,000 target, 0-100. `null` when unknown. */
  progress: number | null;
  /** 24h price change in percent. `null` when unknown. */
  priceChange: number | null;
  /** Price 15 minutes ago, USD. Omitted by the API when unavailable. */
  price15m?: number;
  /** 15-minute price change in percent. Omitted by the API when unavailable. */
  priceChange15m?: number;
}

/**
 * Response of `GET /tokens/king`.
 *
 * The API wraps the token in a `king` envelope rather than returning it bare,
 * and sends `{"king": null}` whenever no token qualifies — every token on the
 * hill has graduated. {@link FyuzClient.getKing} unwraps this for you.
 */
export interface KingResponse {
  /** The leading token still on the bonding curve, or `null` when the hill is empty. */
  king: Token | null;
}

/** Response of `GET /tokens`: one page of tokens plus the total row count. */
export interface TokenPage {
  /** The tokens on this page. */
  tokenList: Token[];
  /** Total rows matching the filter, across all pages. */
  tokenCount: number;
}

/** One wallet's balance in one token. */
export interface Holder {
  id: number;
  tokenAddress: string;
  /** The holding wallet. */
  holderAddress: string;
  /** Balance in whole tokens. Decimal string — do not parse as a float. */
  tokenAmount: string;
  tokenName: string;
  tokenSymbol: string;
  tokenImage: string | null;
  /** USD market cap of the token. Decimal string. */
  marketcap: string;
  network: string;
  creatorAddress: string;
  /** Profile stub for {@link Holder.holderAddress}. */
  user: CreatorInfo;
}

/** Response of `GET /tokens/{network}/{tokenAddress}`. */
export interface TokenDetail {
  /** The token record itself. */
  tokenDetails: Token;
  /** Page of recent trades, newest first. */
  trades: Trade[];
  /** Total trades for this token, across all pages. */
  tradesCount: number;
  /** Holder distribution, largest first. */
  holdersDetails: Holder[];
  /** Price 15 minutes ago, USD. Decimal string, `null` when unknown. */
  fifteenMinPrice: string | null;
  /** 1-day liquidity, USD. Decimal string, `null` when unknown. */
  oneDayLiquidity: string | null;
  /**
   * The bonding curve's own token balance, in whole tokens. Decimal string.
   *
   * `null` means the on-chain read failed and the value is **unknown**. It does
   * not mean zero — rendering it as `0` is a correctness bug. Hide the figure
   * instead.
   */
  curveHolding: string | null;
}

/**
 * One row of `GET /discover` — the highest-signal endpoint for bulk market-data
 * ingestion.
 *
 * Unlike {@link Token}, discovery figures are pre-aggregated and returned as
 * numbers: they are already rounded analytics, not exact ledger amounts.
 */
export interface DiscoverToken {
  tokenAddress: string;
  name: string;
  symbol: string;
  image: string | null;
  network: string;
  creatorAddress: string | null;
  /** USD market cap. */
  marketcap: number;
  /** Token price in USD. */
  priceUsd: number;
  /** Creation time, UNIX **seconds**. */
  createdAt: number;
  /** `true` once the token graduated to a DEX pair. */
  launched: boolean;
  /** Rolling 24h USD volume. */
  volume24h: number;
  /** Buy count in the last 24h. */
  buys24h: number;
  /** Sell count in the last 24h. */
  sells24h: number;
  /** Distinct holders. */
  holders: number;
  /** 24h price change in percent. */
  priceChange24h: number;
  /** Progress toward the $30,000 graduation target, 0-100. */
  graduationPct: number;
}
