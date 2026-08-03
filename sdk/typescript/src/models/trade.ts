/**
 * Trade and candle wire types.
 *
 * @module
 */

import type { Token } from './token.js';

/** Which side of the curve a trade hit. */
export type TradeSide = 'buy' | 'sell';

/** A single swap against the bonding curve or the graduated pair. */
export interface Trade {
  /** Monotonic trade id. Pass the highest one you have as `latestTradeId` to poll incrementally. */
  id: number;
  tokenName: string;
  tokenSymbol: string;
  tokenAddress: string;
  tokenImage: string | null;
  /** The trading wallet. */
  swapperAddress: string;
  swapperUsername: string | null;
  swapperAvatar: string | null;
  /** `"buy"` or `"sell"`, from the trader's perspective. */
  type: TradeSide;
  /** BNB amount. Decimal string — do not parse as a float. */
  ethAmount: string;
  /** Token amount in whole tokens. Decimal string. */
  tokenAmount: string;
  network: string;
  /** Trade time, UNIX **seconds**. */
  date: number;
  /** Transaction hash. */
  txHash: string;
  /** Token price in USD at trade time. Decimal string. */
  tokenPrice: string;
  /** BNB price in USD at trade time. Decimal string. */
  ethPrice: string;
}

/** Response of `GET /trades/recent`. */
export interface RecentTrades {
  /** Platform-wide trades, newest first. */
  trades: Trade[];
  /** The token records the trades reference, so you do not have to fetch them one by one. */
  tokens: Token[];
}

/**
 * One OHLCV candle.
 *
 * Candle values are pre-aggregated analytics and come back as numbers, not
 * decimal strings.
 */
export interface Candle {
  /** Candle open time, UNIX **seconds**. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Volume over the candle, USD. */
  volume: number;
}
