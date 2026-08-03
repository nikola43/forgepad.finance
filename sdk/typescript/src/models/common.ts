/**
 * Shared wire types used across several endpoints.
 *
 * @module
 */

/**
 * Public profile stub attached to tokens, trades and holders.
 *
 * `username` and `avatar` are `null` for wallets that never created a Fyuz
 * profile — which is most of them.
 */
export interface CreatorInfo {
  /** Checksum-less (lower-cased) EVM address. */
  address: string;
  /** Display name, or `null` if the wallet has no profile. */
  username: string | null;
  /** Avatar URL, or `null` if unset. */
  avatar: string | null;
}

/** Response of `GET /health`. */
export interface HealthStatus {
  /** `"ok"` when the API is serving. */
  status: string;
}

/** One chain the API indexes. */
export interface ChainInfo {
  /** Human-readable chain name, e.g. `"BNB Smart Chain"`. */
  name: string;
  /** EIP-155 chain id, e.g. `56` for BNB Smart Chain mainnet. */
  chainId: number;
  /** Chain slug used everywhere else in the API, e.g. `"bsc"`. */
  network?: string;
  /**
   * The Fyuz launchpad contract on this chain — the `to` of every swap.
   *
   * Read from here rather than hardcoded anywhere in the SDK: it is behind an
   * upgradeable proxy, and a new chain should not need an SDK release.
   */
  contractAddress?: string;
  /**
   * A JSON-RPC endpoint for this chain, as configured by the API operator.
   *
   * Treat it as a default, not an entitlement — it may be rate-limited, and it
   * is whatever the operator chose to publish. Production consumers should pass
   * their own via `rpcUrl` on the trade client.
   */
  rpcUrl?: string;
  /** WebSocket sibling of {@link ChainInfo.rpcUrl}. */
  wsUrl?: string;
  /** Native gas currency symbol, e.g. `"BNB"`. */
  currency?: string;
  /** Block explorer root, e.g. `"https://bscscan.com"`. */
  explorerUrl?: string;
  /** DEX venues a graduated token can end up on, e.g. `["pancakeswap:v2"]`. */
  pools?: string[];
  /** USD market cap at which a token graduates off the curve. */
  targetMarketCap?: number;
  /** Tokens minted per launch. */
  totalSupply?: number;
  /** Bonding-curve virtual reserves a new token starts with. */
  virtualEthAmount?: number;
  virtualTokenAmount?: number;
  /** First block the indexer reads. */
  startBlock?: number;
  /**
   * Contract ABI, as served.
   *
   * The SDK does not use it — every selector it needs is pinned in `abi.ts` and
   * asserted against the shared test vectors — but it is here so you can hand it
   * to ethers, viem or web3.py without a second request.
   */
  abi?: unknown[];
}

/** Response of `GET /config`. */
export interface ChainConfig {
  /** Chains the API serves data for. Currently just BNB Smart Chain. */
  chains: ChainInfo[];
}

/**
 * The `{ "error": "..." }` envelope the API returns on every non-2xx response.
 *
 * You rarely touch this directly — it is parsed into {@link FyuzApiError}.
 */
export interface ApiErrorBody {
  error?: string;
}
