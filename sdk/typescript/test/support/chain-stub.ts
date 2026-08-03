/**
 * A stub that answers both halves of a trade: the REST `/config` lookup and the
 * JSON-RPC `eth_call`s that follow it.
 *
 * Both live on one server, so a test only has to start one thing. Requests are
 * routed by path: `/config` is REST, `/rpc` is JSON-RPC.
 */

import { FyuzClient } from '../../src/index.js';
import { startStubServer, type StubServer } from './stub-server.js';

/** A canned `eth_call` result, keyed by the selector the calldata starts with. */
export interface RpcStubs {
  /** Selector (`0x` + 8 hex) to the return data it should answer with. */
  results?: Record<string, string>;
  /** Selector to revert data, for calls that should fail. */
  reverts?: Record<string, string>;
}

/** The chain entry `/config` will serve. */
export const STUB_CHAIN = {
  name: 'BNB Smart Chain',
  chainId: 56,
  network: 'bsc',
  contractAddress: '0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c',
  currency: 'BNB',
  explorerUrl: 'https://bscscan.com',
};

/** One 32-byte word of return data for a `uint256`. */
export function word(value: bigint | number | string): string {
  return BigInt(value).toString(16).padStart(64, '0');
}

/** Return data for `getSwapOutput`: `(amountOut, priceImpact)`. */
export function swapOutputResult(amountOut: bigint | string, priceImpactBps: number): string {
  return `0x${word(amountOut)}${word(priceImpactBps)}`;
}

/**
 * Return data for `tokenPools`: eight words, with `launched` last.
 *
 * Only the flag matters to the SDK, so the reserves are left at zero.
 */
export function tokenPoolsResult(launched: boolean): string {
  return `0x${[0, 0, 0, 0, 0, 0, 0, launched ? 1 : 0].map(word).join('')}`;
}

export interface ChainStub {
  server: StubServer;
  client: FyuzClient;
  /** Every `eth_call` the SDK made, in order, as `{ to, data }`. */
  calls: { to: string; data: string }[];
  close(): Promise<void>;
}

/**
 * Start a stub serving `/config` plus canned `eth_call` answers.
 *
 * An `eth_call` whose selector is in neither map answers `0x`, which decodes as
 * a short response and raises rather than silently reading as zero.
 */
export async function startChainStub(stubs: RpcStubs = {}): Promise<ChainStub> {
  const calls: { to: string; data: string }[] = [];

  const server = await startStubServer((request) => {
    if (request.pathname === '/config') {
      return { body: { chains: [STUB_CHAIN] } };
    }

    if (request.pathname === '/rpc') {
      const payload = JSON.parse(request.body) as {
        id: number;
        method: string;
        params: [{ to: string; data: string }, string];
      };
      const [call] = payload.params;
      calls.push({ to: call.to, data: call.data });

      const selector = call.data.slice(0, 10).toLowerCase();
      const revert = stubs.reverts?.[selector];
      if (revert !== undefined) {
        return {
          body: {
            jsonrpc: '2.0',
            id: payload.id,
            error: { code: 3, message: 'execution reverted', data: revert },
          },
        };
      }
      return {
        body: {
          jsonrpc: '2.0',
          id: payload.id,
          result: stubs.results?.[selector] ?? '0x',
        },
      };
    }

    return { status: 404, body: { error: `no stub for ${request.pathname}` } };
  });

  const client = new FyuzClient({
    baseUrl: server.url,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 5,
    trade: { rpcUrl: `${server.url}/rpc` },
  });

  return {
    server,
    client,
    calls,
    close: () => server.close(),
  };
}
