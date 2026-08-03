/**
 * TypeScript SDK for the Fyuz public REST API.
 *
 * Fyuz is a bonding-curve token launchpad on BNB Smart Chain. Tokens trade on an
 * internal curve until they hit a $30,000 market cap and graduate into a
 * PancakeSwap V2 pair; before that there is no DEX pool, so this API is the only
 * price source for a pre-graduation token.
 *
 * ```ts
 * import { FyuzClient } from '@fyuz/sdk';
 *
 * const client = new FyuzClient();
 * const trending = await client.discover({ tab: 'trending', limit: 10 });
 * ```
 *
 * @module
 */

export { FyuzClient } from './client.js';
export { DistributorClient } from './distributor.js';

export {
  DEFAULT_BASE_URL,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_BASE_DELAY_MS,
  DEFAULT_RETRY_MAX_DELAY_MS,
  DEFAULT_TIMEOUT_MS,
} from './http.js';
export type { FetchLike, FyuzClientOptions, RequestOptions } from './http.js';

export {
  FyuzApiError,
  FyuzConnectionError,
  FyuzError,
  FyuzInvalidArgumentError,
  FyuzNotFoundError,
  FyuzParseError,
  FyuzRateLimitError,
  FyuzTimeoutError,
  isFyuzError,
  isRateLimitError,
} from './errors.js';

export type {
  ChartDataParams,
  DiscoverParams,
  DiscoverTab,
  LeaderboardParams,
  ListRoundsParams,
  ListTokensParams,
  RecentTradesParams,
  SharesParams,
  SortDirection,
  TokenDetailParams,
  TokenStatus,
  TokenTradesParams,
  TopHoldersParams,
} from './params.js';

export * from './models/index.js';

export { USER_AGENT, VERSION } from './version.js';
