/**
 * Wallet and portfolio wire types. All figures are USD aggregates (floats).
 *
 * @module
 */

/** Response of `GET /wallet/{address}`: average-cost PnL rolled up across every token traded. */
export interface WalletStats {
  address: string;
  username: string | null;
  avatar: string | null;
  /** Lifetime USD volume. */
  volumeUsd: number;
  /** Realised PnL in USD. */
  realizedPnlUsd: number;
  /** Unrealised PnL in USD on positions still open. */
  unrealizedPnlUsd: number;
  /** Realised plus unrealised. */
  totalPnlUsd: number;
  /** Return on invested capital, in percent. */
  roiPct: number;
  /** Share of traded tokens that are net profitable, 0-1 (not a percentage). */
  winRate: number;
  /** Distinct tokens traded. */
  tokensTraded: number;
  /** Lifetime trade count. */
  tradeCount: number;
  /** USD value of everything still held. */
  holdingValueUsd: number;
}

/**
 * One token still held by an address.
 *
 * Average-cost basis. Dust positions (balance <= 1e-6) are omitted by the server.
 */
export interface PortfolioPosition {
  tokenAddress: string;
  name: string;
  symbol: string;
  image: string | null;
  network: string;
  /** Net tokens held (buys minus sells), in whole tokens. */
  balance: number;
  currentPriceUsd: number;
  /** `balance * currentPriceUsd`. */
  valueUsd: number;
  /** Cost basis of the open position. */
  costUsd: number;
  avgBuyPriceUsd: number;
  unrealizedPnlUsd: number;
  /** Unrealised PnL as a percentage of cost. */
  unrealizedPnlPct: number;
  /** Realised PnL already booked on this token. */
  realizedPnlUsd: number;
}

/**
 * Response of `GET /portfolio/{address}`: live average-cost PnL.
 *
 * An address with no trades returns zeroed totals and an empty
 * {@link Portfolio.positions} array rather than a 404.
 */
export interface Portfolio {
  address: string;
  /** USD value of all open positions. */
  totalValueUsd: number;
  /** Cost basis of all open positions. */
  totalCostUsd: number;
  unrealizedPnlUsd: number;
  realizedPnlUsd: number;
  totalPnlUsd: number;
  /** Return on invested capital, in percent. */
  roiPct: number;
  /** Open positions, highest value first. */
  positions: PortfolioPosition[];
}
