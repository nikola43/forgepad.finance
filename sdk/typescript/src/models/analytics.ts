/**
 * Per-token analytics wire types.
 *
 * These endpoints return floats rather than decimal strings: the values are
 * already aggregates, so exact 18-decimal precision does not apply.
 *
 * @module
 */

/** Response of `GET /analytics/token/{network}/{address}`. */
export interface TokenAnalytics {
  tokenAddress: string;
  network: string;
  /** Distinct holders. */
  holderCount: number;
  /** Share of supply held by the top 10 holders, in percent. */
  top10Pct: number;
  /** Share of supply held by the creator, in percent. */
  creatorPct: number;
  /** Lifetime buy count. */
  buys: number;
  /** Lifetime sell count. */
  sells: number;
  /** Lifetime USD volume. */
  volumeUsd: number;
  /** Progress toward the $30,000 graduation target, 0-100. */
  graduationPct: number;
  /** `true` once the token graduated to a DEX pair. */
  launched: boolean;
  /** Addresses that bought in the launch block. */
  bundleBuyers: number;
  /** `true` when the bundle-buyer count crosses the suspicious threshold. */
  bundleFlag: boolean;
}

/** One row of `GET /analytics/top-traders/{network}/{address}`, ranked by total PnL. */
export interface TopTrader {
  address: string;
  username: string | null;
  avatar: string | null;
  /** Realised PnL in USD (closed positions). */
  realizedPnlUsd: number;
  /** Unrealised PnL in USD (open position, marked to the current price). */
  unrealizedPnlUsd: number;
  /** Realised plus unrealised. */
  totalPnlUsd: number;
  /** USD volume traded in this token. */
  volumeUsd: number;
  /** `true` when this trader launched the token. */
  isCreator: boolean;
}
