/**
 * The Fyuz API client.
 *
 * @module
 */

import { DistributorClient } from './distributor.js';
import type { FyuzClientOptions, RequestOptions } from './http.js';
import { HttpClient, pathSegment } from './http.js';
import type { ChainConfig, HealthStatus } from './models/common.js';
import type { DiscoverToken, KingResponse, Token, TokenDetail, TokenPage } from './models/token.js';
import type { Candle, RecentTrades, Trade } from './models/trade.js';
import type { TokenAnalytics, TopTrader } from './models/analytics.js';
import type { Portfolio, WalletStats } from './models/wallet.js';
import type { Rewards, TierInfo, TopHolderEntry, UserProfile } from './models/user.js';
import type { KingReign, LeaderboardEntry, ReferralLeaderEntry, Season } from './models/leaderboard.js';
import { paginateTokenPages, paginateTokens } from './pagination.js';
import type {
  ChartDataParams,
  DiscoverParams,
  LeaderboardParams,
  ListTokensParams,
  RecentTradesParams,
  TokenDetailParams,
  TokenTradesParams,
  TopHoldersParams,
} from './params.js';
import { requireInteger, requireString } from './validate.js';

/**
 * Client for the Fyuz public REST API.
 *
 * Fyuz is a bonding-curve token launchpad on BNB Smart Chain. A token trades on an
 * internal curve until it reaches a $30,000 market cap, at which point it
 * *graduates* into a PancakeSwap V2 pair. **Before graduation there is no DEX pool
 * anywhere, so this API is the only source of price data for the token.**
 *
 * Every endpoint is unauthenticated and safe to poll. The API rate-limits at 120
 * requests/minute per IP; the client retries 429 and 5xx responses automatically
 * with exponential backoff and full jitter.
 *
 * ```ts
 * import { FyuzClient } from '@fyuz/sdk';
 *
 * const client = new FyuzClient();
 *
 * // The highest-signal endpoint: one row per token, ready to ingest.
 * for (const token of await client.discover({ tab: 'trending', limit: 20 })) {
 *   const where = token.launched ? 'PancakeSwap' : 'bonding curve';
 *   console.log(`${token.symbol}  $${token.marketcap.toFixed(0)}  (${where})`);
 * }
 *
 * // Walk every page of the token list without touching pageNumber yourself.
 * for await (const token of client.iterateTokens({ orderType: 'marketcap' })) {
 *   console.log(token.tokenSymbol, token.marketcap); // marketcap is a decimal STRING
 * }
 * ```
 */
export class FyuzClient {
  /** Distributor endpoints — the on-chain leaderboard fee distribution. */
  readonly distributor: DistributorClient;

  private readonly http: HttpClient;

  /**
   * @param options - Base URL, timeout, retry budget, custom headers, injected `fetch`.
   *
   * ```ts
   * const client = new FyuzClient({ timeoutMs: 10_000, maxRetries: 5 });
   * ```
   */
  constructor(options: FyuzClientOptions = {}) {
    this.http = new HttpClient(options);
    this.distributor = new DistributorClient(this.http);
  }

  /** The base URL every request is sent to. */
  get baseUrl(): string {
    return this.http.baseUrl;
  }

  // ---------------------------------------------------------------- System

  /** Liveness probe. Returns `{ status: 'ok' }` when the API is serving. */
  async health(options?: RequestOptions): Promise<HealthStatus> {
    return this.http.request<HealthStatus>({ method: 'GET', path: '/health', options });
  }

  /**
   * The chains the API indexes, with their EIP-155 chain ids.
   *
   * Currently just BNB Smart Chain (`56`).
   */
  async getConfig(options?: RequestOptions): Promise<ChainConfig> {
    return this.http.request<ChainConfig>({ method: 'GET', path: '/config', options });
  }

  // ----------------------------------------------------------- Market data

  /**
   * The discovery feed: one pre-aggregated row per token.
   *
   * This is the endpoint to build on if you are ingesting Fyuz market data — it
   * carries market cap, 24h volume, buy/sell counts, holder count and graduation
   * progress in a single round trip.
   *
   * ```ts
   * const graduating = await client.discover({ tab: 'graduating', minHolders: 25 });
   * ```
   */
  async discover(params: DiscoverParams = {}, options?: RequestOptions): Promise<DiscoverToken[]> {
    return this.http.request<DiscoverToken[]>({
      method: 'GET',
      path: '/discover',
      query: {
        tab: params.tab,
        network: params.network,
        minMarketcap: params.minMarketcap,
        minVolume: params.minVolume,
        minHolders: params.minHolders,
        maxAgeSecs: params.maxAgeSecs,
        status: params.status,
        limit: params.limit,
      },
      options,
    });
  }

  /**
   * One page of the full token list, with sorting and free-text search.
   *
   * Returns the complete token record including bonding-curve virtual reserves.
   * Amount fields are decimal strings — see {@link Token}.
   *
   * @see {@link FyuzClient.iterateTokens} to walk every page automatically.
   */
  async listTokens(params: ListTokensParams = {}, options?: RequestOptions): Promise<TokenPage> {
    return this.http.request<TokenPage>({
      method: 'GET',
      path: '/tokens',
      query: {
        orderType: params.orderType,
        orderFlag: params.orderFlag,
        searchWord: params.searchWord,
        network: params.network,
        style: params.style,
        includeNsfw: params.includeNsfw,
        pageNumber: params.pageNumber,
        pageSize: params.pageSize,
      },
      options,
    });
  }

  /**
   * Walk `GET /tokens` page by page, yielding each page as it arrives.
   *
   * Stops when a short page comes back or `tokenCount` has been reached.
   *
   * ```ts
   * for await (const page of client.iterateTokenPages({ pageSize: 100 })) {
   *   console.log(`got ${page.tokenList.length} of ${page.tokenCount}`);
   * }
   * ```
   */
  iterateTokenPages(
    params: ListTokensParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<TokenPage, void, undefined> {
    return paginateTokenPages((page, opts) => this.listTokens(page, opts), params, options);
  }

  /**
   * Walk `GET /tokens` and yield individual tokens, fetching pages as needed.
   *
   * ```ts
   * for await (const token of client.iterateTokens({ searchWord: 'dog' })) {
   *   console.log(token.tokenSymbol);
   * }
   * ```
   */
  iterateTokens(
    params: ListTokensParams = {},
    options?: RequestOptions,
  ): AsyncGenerator<Token, void, undefined> {
    return paginateTokens((page, opts) => this.listTokens(page, opts), params, options);
  }

  /**
   * The current king of the hill — the highest-market-cap token still on the
   * bonding curve.
   *
   * Returns `null` when the hill is empty, which is a real state: a token leaves
   * the moment it graduates, so between a graduation and the next launch there
   * is no king. The API spells this `{"king": null}`; the envelope is unwrapped
   * here.
   *
   * ```ts
   * const king = await client.getKing();
   * console.log(king === null ? 'no king right now' : `${king.tokenSymbol} ${king.marketcap}`);
   * ```
   */
  async getKing(options?: RequestOptions): Promise<Token | null> {
    const body = await this.http.request<KingResponse>({
      method: 'GET',
      path: '/tokens/king',
      options,
    });
    return body.king ?? null;
  }

  /**
   * Full detail for one token: the record itself plus recent trades, holder
   * distribution, the 15-minute price and 1-day liquidity.
   *
   * `curveHolding` is `null` when the on-chain read failed — that means *unknown*,
   * not zero.
   *
   * @param network - Chain slug, currently always `"bsc"`.
   * @param tokenAddress - ERC-20 contract address.
   * @param params - Pagination for the embedded trade list.
   * @throws {@link FyuzNotFoundError} when the token is not indexed.
   */
  async getToken(
    network: string,
    tokenAddress: string,
    params: TokenDetailParams = {},
    options?: RequestOptions,
  ): Promise<TokenDetail> {
    requireString('network', network);
    requireString('tokenAddress', tokenAddress);
    return this.http.request<TokenDetail>({
      method: 'GET',
      path: `/tokens/${pathSegment(network)}/${pathSegment(tokenAddress)}`,
      query: { pageNumber: params.pageNumber, pageSize: params.pageSize },
      options,
    });
  }

  // --------------------------------------------------------------- Trades

  /**
   * The platform-wide trade feed, newest first, with the token records the trades
   * reference. Poll incrementally by passing the highest id you have already seen:
   *
   * ```ts
   * let latestTradeId: number | undefined;
   * setInterval(async () => {
   *   const { trades } = await client.getRecentTrades({ latestTradeId });
   *   if (trades.length > 0) latestTradeId = trades[0]!.id;
   * }, 5_000);
   * ```
   */
  async getRecentTrades(
    params: RecentTradesParams = {},
    options?: RequestOptions,
  ): Promise<RecentTrades> {
    return this.http.request<RecentTrades>({
      method: 'GET',
      path: '/trades/recent',
      query: { latestTradeId: params.latestTradeId, latestTokenId: params.latestTokenId },
      options,
    });
  }

  /**
   * Trade history for a single token, newest first.
   *
   * Sent as a `POST` because the token address travels in the body — it is a read,
   * not a mutation, and needs no authentication.
   *
   * @param tokenAddress - ERC-20 contract address.
   * @param params - `limit` (server default 50), `offset` (server default 0).
   */
  async getTokenTrades(
    tokenAddress: string,
    params: TokenTradesParams = {},
    options?: RequestOptions,
  ): Promise<Trade[]> {
    requireString('tokenAddress', tokenAddress);
    return this.http.request<Trade[]>({
      method: 'POST',
      path: '/trades',
      query: { limit: params.limit, offset: params.offset },
      body: { tokenAddress },
      options,
    });
  }

  /**
   * OHLCV candles for a token, oldest first — shaped for TradingView-style charts.
   *
   * ```ts
   * const now = Math.floor(Date.now() / 1000);
   * const candles = await client.getChartData({
   *   tokenAddress: '0x23a8…',
   *   interval: '5',            // minutes, or '1D'
   *   from: now - 24 * 60 * 60, // UNIX seconds
   *   to: now,
   * });
   * ```
   */
  async getChartData(params: ChartDataParams, options?: RequestOptions): Promise<Candle[]> {
    requireString('tokenAddress', params.tokenAddress);
    requireString('interval', params.interval);
    requireInteger('from', params.from);
    requireInteger('to', params.to);
    return this.http.request<Candle[]>({
      method: 'GET',
      path: '/trades/getChartData',
      query: {
        tokenAddress: params.tokenAddress,
        interval: params.interval,
        from: params.from,
        to: params.to,
        first: params.first,
        dex: params.dex,
        countBack: params.countBack,
      },
      options,
    });
  }

  // ------------------------------------------------------------ Analytics

  /**
   * Holder concentration, buy/sell split, volume, graduation progress and
   * bundle-buyer detection for one token.
   *
   * @throws {@link FyuzNotFoundError} when the token is not indexed.
   */
  async getTokenAnalytics(
    network: string,
    address: string,
    options?: RequestOptions,
  ): Promise<TokenAnalytics> {
    requireString('network', network);
    requireString('address', address);
    return this.http.request<TokenAnalytics>({
      method: 'GET',
      path: `/analytics/token/${pathSegment(network)}/${pathSegment(address)}`,
      options,
    });
  }

  /**
   * The most profitable traders in one token, ranked by total PnL, with the
   * creator flagged.
   */
  async getTopTraders(
    network: string,
    address: string,
    options?: RequestOptions,
  ): Promise<TopTrader[]> {
    requireString('network', network);
    requireString('address', address);
    return this.http.request<TopTrader[]>({
      method: 'GET',
      path: `/analytics/top-traders/${pathSegment(network)}/${pathSegment(address)}`,
      options,
    });
  }

  // -------------------------------------------------------------- Wallets

  /**
   * Average-cost PnL for a wallet, rolled up across every token it has traded,
   * plus win rate, volume and current holding value.
   */
  async getWallet(address: string, options?: RequestOptions): Promise<WalletStats> {
    requireString('address', address);
    return this.http.request<WalletStats>({
      method: 'GET',
      path: `/wallet/${pathSegment(address)}`,
      options,
    });
  }

  /**
   * Current holdings for an address, position by position, with unrealised and
   * realised PnL.
   *
   * An address that has never traded returns zeroed totals and an empty
   * `positions` array — not a 404.
   */
  async getPortfolio(address: string, options?: RequestOptions): Promise<Portfolio> {
    requireString('address', address);
    return this.http.request<Portfolio>({
      method: 'GET',
      path: `/portfolio/${pathSegment(address)}`,
      options,
    });
  }

  // --------------------------------------------------------- Leaderboards

  /**
   * The global points leaderboard, highest projected points first.
   *
   * `rank` is assigned by the server in returned order — do not re-sort. The board
   * resets after every Distributor payout.
   *
   * @param params - `limit` (server default 100, clamped to 1-500).
   */
  async getUserLeaderboard(
    params: LeaderboardParams = {},
    options?: RequestOptions,
  ): Promise<LeaderboardEntry[]> {
    return this.http.request<LeaderboardEntry[]>({
      method: 'GET',
      path: '/users/leaderboard',
      query: { limit: params.limit },
      options,
    });
  }

  /**
   * Public profile for an address: identity, holdings, comments, launched tokens
   * and current-round points.
   *
   * @throws {@link FyuzNotFoundError} when the address has no profile.
   */
  async getUserProfile(address: string, options?: RequestOptions): Promise<UserProfile> {
    requireString('address', address);
    return this.http.request<UserProfile>({
      method: 'GET',
      path: `/users/profile/${pathSegment(address)}`,
      options,
    });
  }

  /**
   * The top wallets by USD trading volume over a window.
   *
   * @param count - How many wallets to return.
   * @param params - Optional `from`/`to` (UNIX seconds) window and `network` filter.
   */
  async getTopHolders(
    count: number,
    params: TopHoldersParams = {},
    options?: RequestOptions,
  ): Promise<TopHolderEntry[]> {
    requireInteger('count', count);
    return this.http.request<TopHolderEntry[]>({
      method: 'GET',
      path: `/users/top/${pathSegment(count)}`,
      query: { from: params.from, to: params.to, network: params.network },
      options,
    });
  }

  /**
   * Past king-of-the-hill reigns, most recent first (max 100).
   *
   * A reign with `endedAt === null` is the one happening right now.
   */
  async getKingsHistory(options?: RequestOptions): Promise<KingReign[]> {
    return this.http.request<KingReign[]>({ method: 'GET', path: '/kings/history', options });
  }

  /**
   * The current season: window, BNB prize pot and standings.
   */
  async getSeason(options?: RequestOptions): Promise<Season> {
    return this.http.request<Season>({ method: 'GET', path: '/season', options });
  }

  /**
   * The referral leaderboard, most active referrers first.
   *
   * Only active referrals — where the referee cleared the net-buy floor — count.
   *
   * @param params - `limit` (server default 100, clamped to 1-500).
   */
  async getReferralLeaderboard(
    params: LeaderboardParams = {},
    options?: RequestOptions,
  ): Promise<ReferralLeaderEntry[]> {
    return this.http.request<ReferralLeaderEntry[]>({
      method: 'GET',
      path: '/referrals/leaderboard',
      query: { limit: params.limit },
      options,
    });
  }

  /**
   * The display tier for an address, derived from lifetime USD volume, with
   * progress toward the next one.
   */
  async getTier(address: string, options?: RequestOptions): Promise<TierInfo> {
    requireString('address', address);
    return this.http.request<TierInfo>({
      method: 'GET',
      path: `/tier/${pathSegment(address)}`,
      options,
    });
  }

  /**
   * Streaks, points, quests and achievements for an address.
   *
   * Read-only: rewards are granted automatically by the indexer as they are
   * earned, so there is no claim call.
   */
  async getRewards(address: string, options?: RequestOptions): Promise<Rewards> {
    requireString('address', address);
    return this.http.request<Rewards>({
      method: 'GET',
      path: `/rewards/${pathSegment(address)}`,
      options,
    });
  }
}
