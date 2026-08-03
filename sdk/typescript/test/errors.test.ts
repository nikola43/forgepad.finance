import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FyuzApiError,
  FyuzConnectionError,
  FyuzInvalidArgumentError,
  FyuzParseError,
  FyuzTimeoutError,
  isFyuzError,
  isRateLimitError,
} from '../src/index.js';
import { always, makeClient, startStubServer, withStub } from './support/stub-server.js';

describe('error handling', () => {
  it('parses the {"error": "..."} envelope into the message', async () => {
    await withStub(
      always({ status: 500, body: { error: 'database unavailable' } }),
      async (_server, client) => {
        await assert.rejects(client.getSeason(), (error: unknown) => {
          assert.ok(error instanceof FyuzApiError);
          assert.equal(error.message, 'database unavailable');
          assert.equal(error.status, 500);
          assert.deepEqual(error.body, { error: 'database unavailable' });
          assert.equal(error.method, 'GET');
          assert.ok(error.url.endsWith('/season'));
          assert.ok(isFyuzError(error));
          assert.equal(isRateLimitError(error), false);
          return true;
        });
      },
      { maxRetries: 0 },
    );
  });

  it('falls back to a status line when the body is not the error envelope', async () => {
    await withStub(
      always({ status: 503, body: '<html>gateway</html>', headers: { 'content-type': 'text/html' } }),
      async (_server, client) => {
        await assert.rejects(client.health(), (error: unknown) => {
          assert.ok(error instanceof FyuzApiError);
          assert.match(error.message, /HTTP 503/);
          assert.equal(error.body, '<html>gateway</html>');
          return true;
        });
      },
      { maxRetries: 0 },
    );
  });

  it('raises a parse error when a 200 body is not JSON', async () => {
    await withStub(always({ body: 'not json at all' }), async (_server, client) => {
      await assert.rejects(client.health(), (error: unknown) => {
        assert.ok(error instanceof FyuzParseError);
        assert.equal(error.status, 200);
        assert.equal(error.bodyText, 'not json at all');
        return true;
      });
    });
  });

  it('times out without retrying', async () => {
    await withStub(
      always({ body: { status: 'ok' }, delayMs: 500 }),
      async (server, client) => {
        await assert.rejects(client.health(), (error: unknown) => {
          assert.ok(error instanceof FyuzTimeoutError);
          assert.equal(error.timeoutMs, 40);
          return true;
        });
        assert.equal(server.requests.length, 1, 'a timeout is the caller deadline, not a retry');
      },
      { timeoutMs: 40 },
    );
  });

  it('propagates a caller abort untouched', async () => {
    await withStub(always({ body: { status: 'ok' }, delayMs: 500 }), async (_server, client) => {
      const controller = new AbortController();
      const pending = client.health({ signal: controller.signal });
      setTimeout(() => controller.abort(), 20).unref();

      await assert.rejects(pending, (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.name, 'AbortError');
        return true;
      });
    });
  });

  it('wraps a refused connection in FyuzConnectionError', async () => {
    const server = await startStubServer(always({ body: {} }));
    const url = server.url;
    await server.close();

    const client = makeClient(url, { maxRetries: 0 });
    await assert.rejects(client.health(), (error: unknown) => {
      assert.ok(error instanceof FyuzConnectionError);
      assert.ok(error.url.endsWith('/health'));
      return true;
    });
  });

  it('rejects invalid arguments before any request is sent', async () => {
    await withStub(always({ body: {} }), async (server, client) => {
      await assert.rejects(client.getWallet(''), FyuzInvalidArgumentError);
      await assert.rejects(client.distributor.getRound(1.5), FyuzInvalidArgumentError);
      assert.equal(server.requests.length, 0);
    });
  });
});
