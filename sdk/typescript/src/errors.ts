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
