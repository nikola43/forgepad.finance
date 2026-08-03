/**
 * A JSON-RPC client just large enough to read the bonding curve.
 *
 * `eth_call` against a view function is an HTTP POST with a JSON body. That is
 * the whole requirement, so this is 80 lines rather than a web3 dependency.
 *
 * @module
 */

import { FyuzConnectionError, FyuzRpcError, FyuzTimeoutError } from './errors.js';
import type { FetchLike } from './http.js';

/** Default per-call timeout for RPC requests, in milliseconds. */
export const DEFAULT_RPC_TIMEOUT_MS = 15_000;

export interface RpcClientOptions {
  /** JSON-RPC endpoint. */
  url: string;
  /** Injected `fetch`, for tests and for runtimes with an unusual global. */
  fetch?: FetchLike;
  /** Per-call timeout in milliseconds. Defaults to 15000. */
  timeoutMs?: number;
  /** Extra headers, e.g. an API key your provider expects. */
  headers?: Record<string, string>;
}

interface JsonRpcResponse {
  jsonrpc?: string;
  id?: number;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/** Parameters for `eth_call`. */
export interface EthCallParams {
  to: string;
  data: string;
  /** Caller address. Some view functions behave differently without one. */
  from?: string;
  /** Block tag or number. Defaults to `latest`. */
  block?: string;
}

/** Minimal JSON-RPC transport. */
export class RpcClient {
  readonly url: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private readonly headers: Record<string, string>;
  private nextId = 1;

  constructor(options: RpcClientOptions) {
    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
      throw new TypeError('global fetch is unavailable; pass one via options.fetch');
    }
    this.url = options.url;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS;
    this.headers = options.headers ?? {};
  }

  /**
   * Invoke a JSON-RPC method.
   *
   * A node-level `error` object becomes {@link FyuzRpcError} — except for the
   * revert case, where `error.data` carries the revert payload. That is returned
   * to the caller through {@link RpcClient.callRaw} rather than thrown here,
   * because only the caller knows enough to say *which* call reverted.
   */
  async request<T>(method: string, params: unknown[]): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...this.headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new FyuzTimeoutError({ timeoutMs: this.timeoutMs, method, url: this.url });
      }
      throw new FyuzConnectionError({ method, url: this.url, cause: error });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    if (!response.ok) {
      throw new FyuzRpcError(`RPC ${method} returned HTTP ${response.status}: ${text.slice(0, 256)}`, {
        method,
      });
    }

    let body: JsonRpcResponse;
    try {
      body = JSON.parse(text) as JsonRpcResponse;
    } catch {
      throw new FyuzRpcError(`RPC ${method} returned a body that is not JSON: ${text.slice(0, 256)}`, {
        method,
      });
    }

    if (body.error !== undefined) {
      throw new FyuzRpcError(`RPC ${method} failed: ${body.error.message ?? 'unknown error'}`, {
        method,
        ...(body.error.code === undefined ? {} : { code: body.error.code }),
        data: body.error.data,
      });
    }

    return body.result as T;
  }

  /**
   * `eth_call`, returning either the return data or the revert data.
   *
   * Reverts are extremely common here — quoting a graduated token reverts by
   * design — so they are a return value rather than an exception. The caller
   * decides what a revert means and builds the error with the right context.
   */
  async callRaw(params: EthCallParams): Promise<{ ok: true; data: string } | { ok: false; revert: string }> {
    const payload: Record<string, string> = { to: params.to, data: params.data };
    if (params.from !== undefined) payload['from'] = params.from;

    try {
      const data = await this.request<string>('eth_call', [payload, params.block ?? 'latest']);
      return { ok: true, data: typeof data === 'string' ? data : '0x' };
    } catch (error) {
      if (error instanceof FyuzRpcError) {
        const revert = extractRevertData(error);
        if (revert !== undefined) return { ok: false, revert };
      }
      throw error;
    }
  }

  /** `eth_call` that throws on revert, for calls that should never revert. */
  async call(params: EthCallParams): Promise<string> {
    const result = await this.callRaw(params);
    if (result.ok) return result.data;
    throw new FyuzRpcError(`eth_call to ${params.to} reverted (${result.revert})`, {
      method: 'eth_call',
    });
  }
}

/**
 * Dig the revert payload out of a node error.
 *
 * Every provider spells this differently: geth puts the hex straight in
 * `error.data`, others nest it as `error.data.data`, and some drop it into the
 * message text and nothing else. All three are tried, in decreasing order of
 * how much you can trust them, before falling back to `'0x'` — which says "it
 * reverted, and this node would not tell us why".
 */
function extractRevertData(error: FyuzRpcError): string | undefined {
  const hex = (value: unknown): string | undefined =>
    typeof value === 'string' && /^0x[0-9a-fA-F]*$/.test(value) ? value : undefined;

  const direct = hex(error.data);
  if (direct !== undefined) return direct;

  if (typeof error.data === 'object' && error.data !== null) {
    const nested = hex((error.data as { data?: unknown }).data);
    if (nested !== undefined) return nested;
  }

  const match = /0x[0-9a-fA-F]{8,}/.exec(error.message);
  if (match !== null) return match[0];

  return /revert/i.test(error.message) ? '0x' : undefined;
}
