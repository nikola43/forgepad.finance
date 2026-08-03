/**
 * A tiny local HTTP server the tests run against.
 *
 * Nothing in this suite ever touches the network: every request goes to
 * 127.0.0.1 on an ephemeral port.
 */

import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { FyuzClient, type FyuzClientOptions } from '../../src/index.js';

/** One request the stub server received. */
export interface RecordedRequest {
  method: string;
  /** Path plus query string, exactly as it arrived on the wire. */
  url: string;
  pathname: string;
  query: URLSearchParams;
  headers: IncomingHttpHeaders;
  body: string;
}

/** What the stub should reply with. */
export interface StubResponse {
  status?: number;
  /** Object bodies are JSON-encoded; string bodies are sent verbatim. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Hold the response back, to exercise timeouts. */
  delayMs?: number;
}

/** Decides the reply for each incoming request. */
export type Handler = (request: RecordedRequest, index: number) => StubResponse;

export interface StubServer {
  url: string;
  requests: RecordedRequest[];
  close(): Promise<void>;
}

/** Start a stub server on an ephemeral loopback port. */
export async function startStubServer(handler: Handler): Promise<StubServer> {
  const requests: RecordedRequest[] = [];

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const parsed = new URL(req.url ?? '/', 'http://127.0.0.1');
      const recorded: RecordedRequest = {
        method: req.method ?? 'GET',
        url: req.url ?? '/',
        pathname: parsed.pathname,
        query: parsed.searchParams,
        headers: req.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      };
      requests.push(recorded);

      const stub = handler(recorded, requests.length - 1);
      const send = (): void => {
        try {
          const body = typeof stub.body === 'string' ? stub.body : JSON.stringify(stub.body ?? {});
          res.writeHead(stub.status ?? 200, {
            'content-type': 'application/json',
            ...stub.headers,
          });
          res.end(body);
        } catch {
          // The socket went away (aborted or timed-out test) — nothing to do.
        }
      };

      if (stub.delayMs !== undefined && stub.delayMs > 0) {
        setTimeout(send, stub.delayMs).unref();
      } else {
        send();
      }
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${port}`,
    requests,
    close(): Promise<void> {
      server.closeAllConnections();
      return new Promise<void>((resolve, reject) => {
        server.close((err) => (err === undefined || err === null ? resolve() : reject(err)));
      });
    },
  };
}

/** Run `body` against a freshly started stub server, then shut it down. */
export async function withStub(
  handler: Handler,
  body: (server: StubServer, client: FyuzClient) => Promise<void>,
  clientOptions: Omit<FyuzClientOptions, 'baseUrl'> = {},
): Promise<void> {
  const server = await startStubServer(handler);
  try {
    await body(server, makeClient(server.url, clientOptions));
  } finally {
    await server.close();
  }
}

/**
 * A client pointed at the stub with near-zero backoff, so retry tests stay fast
 * without weakening the retry logic under test.
 */
export function makeClient(
  baseUrl: string,
  overrides: Omit<FyuzClientOptions, 'baseUrl'> = {},
): FyuzClient {
  return new FyuzClient({
    baseUrl,
    retryBaseDelayMs: 1,
    retryMaxDelayMs: 5,
    ...overrides,
  });
}

/** Reply with each response in turn, repeating the last one once the queue runs dry. */
export function queue(responses: StubResponse[]): Handler {
  return (_request, index) => responses[Math.min(index, responses.length - 1)] ?? {};
}

/** Always reply with the same thing. */
export function always(response: StubResponse): Handler {
  return () => response;
}
