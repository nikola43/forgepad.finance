/**
 * Typed errors thrown by the SDK.
 *
 * Everything the SDK throws (other than a caller-triggered `AbortError`) extends
 * {@link FyuzError}, so one `catch` can cover the whole surface while still letting
 * you single out rate limiting:
 *
 * ```ts
 * import { FyuzClient, FyuzRateLimitError, FyuzNotFoundError, FyuzError } from '@fyuz/sdk';
 *
 * try {
 *   const token = await client.getToken('bsc', '0xabc…');
 * } catch (err) {
 *   if (err instanceof FyuzRateLimitError) {
 *     console.warn('backing off', err.retryAfterSeconds);
 *   } else if (err instanceof FyuzNotFoundError) {
 *     console.warn('no such token');
 *   } else if (err instanceof FyuzError) {
 *     console.error(err.message);
 *   } else {
 *     throw err;
 *   }
 * }
 * ```
 *
 * @module
 */

import type { ApiErrorBody } from './models/common.js';

/** Base class for every error the SDK raises. */
export class FyuzError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions);
    this.name = 'FyuzError';
  }
}

/**
 * The API returned a non-2xx status.
 *
 * {@link FyuzApiError.message} is the server's `{"error": "..."}` envelope when it
 * sent one, otherwise a generic status line.
 */
export class FyuzApiError extends FyuzError {
  /** HTTP status code. */
  readonly status: number;
  /** HTTP method of the failed request. */
  readonly method: string;
  /** Full URL of the failed request, query string included. */
  readonly url: string;
  /** Parsed JSON body when the server sent JSON, otherwise the raw text. */
  readonly body: unknown;
  /**
   * Parsed `Retry-After` value in seconds, when the server sent one.
   *
   * Not a 429-only header: a 503 from a draining load balancer or a host in
   * maintenance carries it just as often, so it is parsed for every status.
   */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    init: {
      status: number;
      method: string;
      url: string;
      body: unknown;
      retryAfterSeconds?: number;
    },
  ) {
    super(message);
    this.name = 'FyuzApiError';
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.body = init.body;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }
}

/**
 * HTTP 429 — the per-IP rate limit (120 requests/minute) was exceeded.
 *
 * The client retries these automatically; you only see one when the retry budget
 * is exhausted or retries are disabled.
 */
export class FyuzRateLimitError extends FyuzApiError {
  constructor(
    message: string,
    init: { status: number; method: string; url: string; body: unknown; retryAfterSeconds?: number },
  ) {
    super(message, init);
    this.name = 'FyuzRateLimitError';
  }
}

/** HTTP 404 — no such token, round or profile. Never retried. */
export class FyuzNotFoundError extends FyuzApiError {
  constructor(
    message: string,
    init: {
      status: number;
      method: string;
      url: string;
      body: unknown;
      retryAfterSeconds?: number;
    },
  ) {
    super(message, init);
    this.name = 'FyuzNotFoundError';
  }
}

/** The request exceeded the configured timeout. Not retried — the deadline was yours. */
export class FyuzTimeoutError extends FyuzError {
  /** The timeout that elapsed, in milliseconds. */
  readonly timeoutMs: number;
  readonly method: string;
  readonly url: string;

  constructor(init: { timeoutMs: number; method: string; url: string }) {
    super(`${init.method} ${init.url} timed out after ${init.timeoutMs}ms`);
    this.name = 'FyuzTimeoutError';
    this.timeoutMs = init.timeoutMs;
    this.method = init.method;
    this.url = init.url;
  }
}

/**
 * The request never reached the API: DNS failure, refused connection, TLS error,
 * dropped socket. Retried like a 5xx, since these are usually transient.
 */
export class FyuzConnectionError extends FyuzError {
  readonly method: string;
  readonly url: string;

  constructor(init: { method: string; url: string; cause: unknown }) {
    super(`${init.method} ${init.url} failed: ${describe(init.cause)}`, { cause: init.cause });
    this.name = 'FyuzConnectionError';
    this.method = init.method;
    this.url = init.url;
  }
}

/** A 2xx response whose body was not valid JSON. Almost always a proxy in the way. */
export class FyuzParseError extends FyuzError {
  readonly status: number;
  readonly method: string;
  readonly url: string;
  /** The raw body, truncated to 512 characters. */
  readonly bodyText: string;

  constructor(init: { status: number; method: string; url: string; bodyText: string; cause: unknown }) {
    super(`${init.method} ${init.url} returned a non-JSON body (status ${init.status})`, {
      cause: init.cause,
    });
    this.name = 'FyuzParseError';
    this.status = init.status;
    this.method = init.method;
    this.url = init.url;
    this.bodyText = init.bodyText.slice(0, 512);
  }
}

/** An argument failed validation before any request was sent. */
export class FyuzInvalidArgumentError extends FyuzError {
  constructor(message: string) {
    super(message);
    this.name = 'FyuzInvalidArgumentError';
  }
}

/**
 * How a contract revert was classified. Mirrors `surfaced_as` in
 * `shared/test-vectors/trade-errors.json`.
 */
export type RevertKind =
  | 'graduated'
  | 'no_pool'
  | 'slippage'
  | 'expired'
  | 'price_impact'
  | 'sell_too_large'
  | 'insufficient_value'
  | 'insufficient_balance'
  | 'insufficient_input'
  | 'insufficient_liquidity'
  | 'zero_amount'
  | 'stale_feed'
  | 'paused'
  | 'revert_string'
  | 'unknown';

/**
 * The contract rejected the call.
 *
 * Raised from a simulated `eth_call`, so it costs nothing — this is the failure
 * you want, rather than paying gas to discover the same thing on-chain.
 */
export class FyuzContractRevertError extends FyuzError {
  /** Classification from the shared revert table. */
  readonly kind: RevertKind;
  /** Solidity error signature, e.g. `SlippageExceeded()`. Undefined when unrecognised. */
  readonly errorName: string | undefined;
  /** The 4-byte selector, when the revert carried one. */
  readonly selector: string | undefined;
  /** Raw revert data, kept so an unrecognised revert is still diagnosable. */
  readonly data: string;
  /** Whether re-quoting and retrying could plausibly succeed. */
  readonly retryable: boolean;

  constructor(
    message: string,
    init: {
      kind: RevertKind;
      errorName?: string;
      selector?: string;
      data: string;
      retryable?: boolean;
    },
  ) {
    super(message);
    this.name = 'FyuzContractRevertError';
    this.kind = init.kind;
    this.errorName = init.errorName;
    this.selector = init.selector;
    this.data = init.data;
    this.retryable = init.retryable ?? false;
  }
}

/**
 * The token graduated: it left the bonding curve and trades on a DEX pair now.
 *
 * Every swap entrypoint reverts with `AlreadyLaunched()` for such a token, so
 * the SDK refuses to build the transaction rather than let you pay gas to find
 * out. Trade {@link FyuzTokenGraduatedError.pairAddress} on PancakeSwap instead.
 */
export class FyuzTokenGraduatedError extends FyuzContractRevertError {
  /** The token that graduated. */
  readonly tokenAddress: string;
  /** Its DEX pair, when the read API knows it. */
  readonly pairAddress: string | undefined;

  constructor(init: { tokenAddress: string; pairAddress?: string; data?: string }) {
    super(
      `${init.tokenAddress} has graduated: the bonding curve is closed and every swap reverts. ` +
        (init.pairAddress === undefined
          ? 'Trade its DEX pair instead.'
          : `Trade the DEX pair ${init.pairAddress} instead.`),
      {
        kind: 'graduated',
        errorName: 'AlreadyLaunched()',
        selector: '0xcfa6d878',
        data: init.data ?? '0xcfa6d878',
        retryable: false,
      },
    );
    this.name = 'FyuzTokenGraduatedError';
    this.tokenAddress = init.tokenAddress;
    this.pairAddress = init.pairAddress;
  }
}

/** A JSON-RPC node returned an error, or something that was not a JSON-RPC response. */
export class FyuzRpcError extends FyuzError {
  /** JSON-RPC error code, when the node sent a well-formed error object. */
  readonly code: number | undefined;
  /** The method that failed, e.g. `eth_call`. */
  readonly method: string;
  /**
   * The node's `error.data`, untouched.
   *
   * For a reverted `eth_call` this is where the revert payload lives — but only
   * on providers that send it there, hence keeping the raw value rather than a
   * parsed one.
   */
  readonly data: unknown;

  constructor(message: string, init: { method: string; code?: number; data?: unknown }) {
    super(message);
    this.name = 'FyuzRpcError';
    this.method = init.method;
    this.code = init.code;
    this.data = init.data;
  }
}

/** Type guard for every error this SDK raises. */
export function isFyuzError(value: unknown): value is FyuzError {
  return value instanceof FyuzError;
}

/** Type guard for HTTP 429 responses. */
export function isRateLimitError(value: unknown): value is FyuzRateLimitError {
  return value instanceof FyuzRateLimitError;
}

/**
 * Build the right error subclass for a non-2xx response.
 *
 * @internal
 */
export function errorFromResponse(init: {
  status: number;
  method: string;
  url: string;
  bodyText: string;
  retryAfterHeader: string | null;
}): FyuzApiError {
  const body = safeJsonParse(init.bodyText);
  const envelope = extractErrorMessage(body);
  const message =
    envelope ?? `${init.method} ${init.url} failed with HTTP ${init.status}`;
  // Parsed for every status, not just 429: a 503 from a draining load balancer
  // carries Retry-After too, and the retry loop should honour it there as well.
  const retryAfterSeconds = parseRetryAfter(init.retryAfterHeader);
  const common = {
    status: init.status,
    method: init.method,
    url: init.url,
    body: body ?? init.bodyText,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  };

  if (init.status === 429) {
    return new FyuzRateLimitError(message, common);
  }
  if (init.status === 404) {
    return new FyuzNotFoundError(message, common);
  }
  return new FyuzApiError(message, common);
}

/**
 * Parse a `Retry-After` header: either delta-seconds or an HTTP date.
 *
 * @returns seconds to wait, or `undefined` when the header is absent or unparseable.
 * @internal
 */
export function parseRetryAfter(header: string | null, now: number = Date.now()): number | undefined {
  if (header === null) return undefined;
  const trimmed = header.trim();
  if (trimmed === '') return undefined;

  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed);
  }
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, (asDate - now) / 1000);
}

function safeJsonParse(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function extractErrorMessage(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const envelope = body as ApiErrorBody;
  return typeof envelope.error === 'string' && envelope.error !== '' ? envelope.error : undefined;
}

function describe(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
