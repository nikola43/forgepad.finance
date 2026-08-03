/**
 * Transport: URL building, timeouts, retries and error mapping.
 *
 * Everything here is internal plumbing except {@link FyuzClientOptions} and
 * {@link RequestOptions}, which are part of the public surface.
 *
 * @module
 */

import {
  errorFromResponse,
  FyuzApiError,
  FyuzConnectionError,
  FyuzError,
  FyuzParseError,
  FyuzRateLimitError,
  FyuzTimeoutError,
} from './errors.js';
import { USER_AGENT } from './version.js';

/** The `fetch` implementation the client uses. Matches the global `fetch` signature. */
export type FetchLike = typeof globalThis.fetch;

type FetchResponse = Awaited<ReturnType<FetchLike>>;
type FetchInit = NonNullable<Parameters<FetchLike>[1]>;

/** Production API base URL. */
export const DEFAULT_BASE_URL = 'https://api.fyuz.fun';
/** Default per-attempt timeout: 30 seconds. */
export const DEFAULT_TIMEOUT_MS = 30_000;
/** Default retry budget: 3 retries (4 attempts total). */
export const DEFAULT_MAX_RETRIES = 3;
/** Default first-retry backoff window: 250ms. */
export const DEFAULT_RETRY_BASE_DELAY_MS = 250;
/** Default backoff ceiling: 8 seconds. Matches the Go, Python and Rust SDKs. */
export const DEFAULT_RETRY_MAX_DELAY_MS = 8_000;

/**
 * Options accepted by the {@link FyuzClient} constructor.
 *
 * The numeric options are truncated to integers; a non-finite value (`NaN`,
 * `Infinity` — e.g. `parseInt` on an unset environment variable) falls back to
 * the documented default rather than corrupting the retry loop.
 */
export interface FyuzClientOptions {
  /** API base URL. Defaults to `https://api.fyuz.fun`. A trailing slash is ignored. */
  baseUrl?: string;
  /** Per-attempt timeout in milliseconds. Defaults to 30000. */
  timeoutMs?: number;
  /**
   * How many times to retry a retryable failure. Defaults to 3; `0` disables
   * retrying entirely.
   */
  maxRetries?: number;
  /** Backoff window for the first retry, in milliseconds. Defaults to 250. */
  retryBaseDelayMs?: number;
  /** Upper bound on any single backoff sleep, in milliseconds. Defaults to 8000. */
  retryMaxDelayMs?: number;
  /** Extra headers sent with every request. */
  headers?: Record<string, string>;
  /** Override the `User-Agent`. Defaults to `fyuz-sdk-typescript/<version>`. */
  userAgent?: string;
  /**
   * Inject a `fetch` implementation — handy for tests, proxies and
   * instrumentation. Defaults to the global `fetch`.
   */
  fetch?: FetchLike;
  /**
   * Options for {@link FyuzClient.trade} — RPC endpoint, RPC timeout, RPC headers.
   *
   * Typed loosely here so `http.ts` does not have to import the trade module;
   * {@link TradeClientOptions} is the real shape.
   */
  trade?: {
    rpcUrl?: string;
    rpcTimeoutMs?: number;
    rpcHeaders?: Record<string, string>;
  };
}

/** Per-call overrides. Every client method takes these as its last argument. */
export interface RequestOptions {
  /** Cancel the call (and any pending backoff sleep). Aborting is never retried. */
  signal?: AbortSignal;
  /** Override the per-attempt timeout for this call. */
  timeoutMs?: number;
  /** Override the retry budget for this call. `0` disables retrying. */
  maxRetries?: number;
  /** Extra headers for this call, merged over the client-level ones. */
  headers?: Record<string, string>;
}

/** A value that can appear in a query string. `undefined` and `null` are dropped. */
export type QueryValue = string | number | boolean | null | undefined;

/** A bag of query parameters. */
export type QueryParams = Record<string, QueryValue>;

interface RequestSpec {
  method: 'GET' | 'POST';
  path: string;
  query?: QueryParams;
  body?: unknown;
  options?: RequestOptions | undefined;
}

/**
 * Serialise a query bag, dropping `undefined` and `null` so the server's own
 * defaults apply.
 *
 * @internal
 */
export function buildQueryString(query: QueryParams | undefined): string {
  if (query === undefined) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    search.append(key, typeof value === 'string' ? value : String(value));
  }
  const encoded = search.toString();
  return encoded === '' ? '' : `?${encoded}`;
}

/**
 * Percent-encode one path segment.
 *
 * @internal
 */
export function pathSegment(value: string | number): string {
  return encodeURIComponent(String(value));
}

/**
 * Sleep, waking early (and rejecting) if the caller aborts.
 *
 * @internal
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted === true) {
      reject(abortReason(signal));
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = (): void => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal | undefined): unknown {
  const reason: unknown = signal?.reason;
  return reason ?? new FyuzError('Request aborted');
}

/**
 * The HTTP engine shared by {@link FyuzClient} and its sub-clients.
 *
 * @internal
 */
export class HttpClient {
  readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly retryMaxDelayMs: number;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: FetchLike;

  constructor(options: FyuzClientOptions = {}) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new FyuzError(
        'No global fetch available. Use Node 18+ or pass a fetch implementation via the `fetch` option.',
      );
    }

    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = numericOption(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1);
    this.maxRetries = numericOption(options.maxRetries, DEFAULT_MAX_RETRIES, 0);
    this.retryBaseDelayMs = numericOption(options.retryBaseDelayMs, DEFAULT_RETRY_BASE_DELAY_MS, 0);
    this.retryMaxDelayMs = numericOption(options.retryMaxDelayMs, DEFAULT_RETRY_MAX_DELAY_MS, 0);
    this.fetchImpl = options.fetch === undefined ? fetchImpl.bind(globalThis) : fetchImpl;
    this.headers = {
      accept: 'application/json',
      // Dropped by browsers (forbidden header name); honoured everywhere else.
      'user-agent': options.userAgent ?? USER_AGENT,
      ...lowerCaseKeys(options.headers),
    };
  }

  /** Issue a request, retrying transient failures. */
  async request<T>(spec: RequestSpec): Promise<T> {
    const url = `${this.baseUrl}${spec.path}${buildQueryString(spec.query)}`;
    const maxRetries = numericOption(spec.options?.maxRetries, this.maxRetries, 0);
    const timeoutMs = numericOption(spec.options?.timeoutMs, this.timeoutMs, 1);
    const headers: Record<string, string> = {
      ...this.headers,
      ...lowerCaseKeys(spec.options?.headers),
    };
    let payload: string | undefined;
    if (spec.body !== undefined) {
      payload = JSON.stringify(spec.body);
      headers['content-type'] = 'application/json';
    }

    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt<T>(spec, url, headers, payload, timeoutMs);
      } catch (error) {
        if (attempt >= maxRetries || !isRetryable(error)) throw error;
        await sleep(this.backoffMs(error, attempt), spec.options?.signal);
      }
    }
  }

  private async attempt<T>(
    spec: RequestSpec,
    url: string,
    headers: Record<string, string>,
    payload: string | undefined,
    timeoutMs: number,
  ): Promise<T> {
    const external = spec.options?.signal;
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const onExternalAbort = (): void => controller.abort(external?.reason);
    if (external !== undefined) {
      if (external.aborted) {
        clearTimeout(timer);
        throw abortReason(external);
      }
      external.addEventListener('abort', onExternalAbort, { once: true });
    }

    const init: FetchInit = {
      method: spec.method,
      headers,
      signal: controller.signal,
    };
    if (payload !== undefined) init.body = payload;

    try {
      const response = await this.fetchImpl(url, init);
      return await readResponse<T>(response, spec.method, url);
    } catch (error) {
      if (external?.aborted === true) throw error;
      if (timedOut) throw new FyuzTimeoutError({ timeoutMs, method: spec.method, url });
      if (error instanceof FyuzError) throw error;
      throw new FyuzConnectionError({ method: spec.method, url, cause: error });
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onExternalAbort);
    }
  }

  /**
   * Exponential backoff with full jitter, raised to the server's `Retry-After`
   * when it sent one and capped at `retryMaxDelayMs` either way. `Retry-After`
   * can only lengthen the wait: a `Retry-After: 0` from a proxy must not turn
   * the retry loop into a hot loop against a rate limiter.
   *
   * The header is honoured on any retryable status, not only 429 — a 503 from a
   * draining load balancer states its own recovery window just as usefully.
   */
  private backoffMs(error: unknown, attempt: number): number {
    const ceiling = Math.min(this.retryBaseDelayMs * 2 ** attempt, this.retryMaxDelayMs);
    const jittered = Math.random() * ceiling;
    if (error instanceof FyuzApiError && error.retryAfterSeconds !== undefined) {
      return Math.min(Math.max(error.retryAfterSeconds * 1000, jittered), this.retryMaxDelayMs);
    }
    return jittered;
  }
}

async function readResponse<T>(response: FetchResponse, method: string, url: string): Promise<T> {
  const text = await response.text();
  if (!response.ok) {
    throw errorFromResponse({
      status: response.status,
      method,
      url,
      bodyText: text,
      retryAfterHeader: response.headers.get('retry-after'),
    });
  }
  if (text.trim() === '') {
    // Every documented response carries a JSON body, so an empty one is a broken
    // proxy — surface it as a parse error instead of handing back `undefined`
    // behind a non-nullable type.
    throw new FyuzParseError({
      status: response.status,
      method,
      url,
      bodyText: text,
      cause: new Error('empty response body'),
    });
  }
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new FyuzParseError({ status: response.status, method, url, bodyText: text, cause });
  }
}

/**
 * 429 and 5xx are retried, as are connection failures. Every other 4xx is a
 * client mistake and is surfaced immediately; timeouts and aborts are never
 * retried because the deadline belongs to the caller.
 */
function isRetryable(error: unknown): boolean {
  if (error instanceof FyuzRateLimitError) return true;
  if (error instanceof FyuzApiError) return error.status >= 500;
  return error instanceof FyuzConnectionError;
}

/**
 * Coerce a numeric option to a usable value.
 *
 * `NaN`/`Infinity` fall back to the default — `maxRetries: parseInt(process.env.X)`
 * on an unset variable is `NaN`, and `attempt >= NaN` is always false, which would
 * retry forever. Finite values are truncated to an integer and floored at `minimum`.
 */
function numericOption(value: number | undefined, fallback: number, minimum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(minimum, Math.trunc(value));
}

function lowerCaseKeys(headers: Record<string, string> | undefined): Record<string, string> {
  if (headers === undefined) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) out[key.toLowerCase()] = value;
  return out;
}
