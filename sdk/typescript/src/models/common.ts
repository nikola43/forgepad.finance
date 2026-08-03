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
