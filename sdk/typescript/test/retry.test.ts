import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FyuzApiError, FyuzNotFoundError, FyuzRateLimitError } from '../src/index.js';
import { always, queue, withStub } from './support/stub-server.js';

const RATE_LIMITED = { status: 429, body: { error: 'Too many requests' } };
const OK = { body: { status: 'ok' } };

describe('retry behaviour', () => {
  it('retries a 429 and then succeeds', async () => {
    await withStub(queue([RATE_LIMITED, OK]), async (server, client) => {
      const health = await client.health();

      assert.deepEqual(health, { status: 'ok' });
      assert.equal(server.requests.length, 2, 'one rate-limited attempt plus one success');
    });
  });

  it('retries 5xx responses', async () => {
    await withStub(
      queue([
        { status: 502, body: { error: 'bad gateway' } },
        { status: 500, body: { error: 'boom' } },
        OK,
      ]),
      async (server, client) => {
        await client.health();
        assert.equal(server.requests.length, 3);
      },
    );
  });

  it('gives up after the retry budget and surfaces the rate-limit error', async () => {
    await withStub(
      always(RATE_LIMITED),
      async (server, client) => {
        await assert.rejects(
          client.health(),
          (error: unknown) => {
            assert.ok(error instanceof FyuzRateLimitError);
            assert.equal(error.status, 429);
            assert.equal(error.message, 'Too many requests');
            return true;
          },
        );
        assert.equal(server.requests.length, 3, 'initial attempt plus two retries');
      },
      { maxRetries: 2 },
    );
  });

  it('does not retry when maxRetries is 0', async () => {
    await withStub(
      always(RATE_LIMITED),
      async (server, client) => {
        await assert.rejects(client.health(), FyuzRateLimitError);
        assert.equal(server.requests.length, 1);
      },
      { maxRetries: 0 },
    );
  });

  it('honours a per-request retry override', async () => {
    await withStub(always(RATE_LIMITED), async (server, client) => {
      await assert.rejects(client.health({ maxRetries: 0 }), FyuzRateLimitError);
      assert.equal(server.requests.length, 1);
    });
  });

  it('honours Retry-After but caps the wait at retryMaxDelayMs', async () => {
    const startedAt = Date.now();

    await withStub(
      queue([{ ...RATE_LIMITED, headers: { 'retry-after': '30' } }, OK]),
      async (server, client) => {
        await client.health();
        assert.equal(server.requests.length, 2);
      },
      { retryMaxDelayMs: 5 },
    );

    assert.ok(
      Date.now() - startedAt < 2_000,
      'a 30 second Retry-After must be clamped to retryMaxDelayMs',
    );
  });

  it('exposes Retry-After on the thrown error', async () => {
    await withStub(
      always({ ...RATE_LIMITED, headers: { 'retry-after': '7' } }),
      async (_server, client) => {
        await assert.rejects(client.health(), (error: unknown) => {
          assert.ok(error instanceof FyuzRateLimitError);
          assert.equal(error.retryAfterSeconds, 7);
          return true;
        });
      },
      { maxRetries: 0 },
    );
  });

  it('honours Retry-After on a 5xx, not only on a 429', async () => {
    // Retry-After is not a 429-only header: a draining load balancer sends it
    // with a 503. Honouring it only on 429 throws away the one delay the server
    // actually asked for.
    const startedAt = Date.now();

    await withStub(
      queue([
        { status: 503, body: { error: 'draining' }, headers: { 'retry-after': '1' } },
        OK,
      ]),
      async (server, client) => {
        await client.health();
        assert.equal(server.requests.length, 2);
      },
      // Backoff alone would be at most 5ms; only the header can push the wait
      // out to a second.
      { retryBaseDelayMs: 5, retryMaxDelayMs: 5_000 },
    );

    assert.ok(
      Date.now() - startedAt >= 900,
      'the 503 Retry-After of 1s must be waited out, not ignored',
    );
  });

  it('exposes Retry-After on a non-429 error too', async () => {
    await withStub(
      always({ status: 503, body: { error: 'draining' }, headers: { 'retry-after': '9' } }),
      async (_server, client) => {
        await assert.rejects(client.health(), (error: unknown) => {
          assert.ok(error instanceof FyuzApiError);
          assert.equal(error.status, 503);
          assert.equal(error.retryAfterSeconds, 9);
          return true;
        });
      },
      { maxRetries: 0 },
    );
  });

  it('never retries a 4xx that is not 429', async () => {
    await withStub(
      always({ status: 400, body: { error: 'Bad request' } }),
      async (server, client) => {
        await assert.rejects(client.health(), (error: unknown) => {
          assert.ok(error instanceof FyuzApiError);
          assert.ok(!(error instanceof FyuzRateLimitError));
          assert.equal(error.status, 400);
          return true;
        });
        assert.equal(server.requests.length, 1);
      },
    );
  });

  it('never retries a 404', async () => {
    await withStub(always({ status: 404, body: { error: 'Token not found' } }), async (server, client) => {
      await assert.rejects(client.getToken('bsc', '0xabc'), (error: unknown) => {
        assert.ok(error instanceof FyuzNotFoundError);
        assert.equal(error.message, 'Token not found');
        return true;
      });
      assert.equal(server.requests.length, 1);
    });
  });
});
