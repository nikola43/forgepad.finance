import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { Handler } from './support/stub-server.js';
import { withStub } from './support/stub-server.js';
import { makeToken } from './support/fixtures.js';

/** Serve `total` tokens, `pageSize` at a time, honouring the pageNumber query. */
function pagedTokens(total: number, pageSize: number): Handler {
  return (request) => {
    const pageNumber = Number(request.query.get('pageNumber') ?? '1');
    const start = (pageNumber - 1) * pageSize;
    const ids = Array.from({ length: total }, (_unused, index) => index + 1).slice(start, start + pageSize);
    return { body: { tokenList: ids.map(makeToken), tokenCount: total } };
  };
}

describe('auto-pagination', () => {
  it('walks every page and yields each token once', async () => {
    await withStub(pagedTokens(5, 2), async (server, client) => {
      const symbols: string[] = [];
      for await (const token of client.iterateTokens({ pageSize: 2 })) {
        symbols.push(token.tokenSymbol);
      }

      assert.deepEqual(symbols, ['TKN1', 'TKN2', 'TKN3', 'TKN4', 'TKN5']);
      assert.equal(server.requests.length, 3);
      assert.deepEqual(
        server.requests.map((request) => request.query.get('pageNumber')),
        ['1', '2', '3'],
      );
      assert.equal(server.requests[0]!.query.get('pageSize'), '2');
    });
  });

  it('stops once tokenCount is reached, without an extra empty request', async () => {
    await withStub(pagedTokens(4, 2), async (server, client) => {
      const tokens = [];
      for await (const token of client.iterateTokens({ pageSize: 2 })) tokens.push(token);

      assert.equal(tokens.length, 4);
      assert.equal(server.requests.length, 2, 'the second page completes the count');
    });
  });

  it('yields whole pages through iterateTokenPages', async () => {
    await withStub(pagedTokens(3, 2), async (_server, client) => {
      const sizes: number[] = [];
      for await (const page of client.iterateTokenPages({ pageSize: 2 })) {
        assert.equal(page.tokenCount, 3);
        sizes.push(page.tokenList.length);
      }

      assert.deepEqual(sizes, [2, 1]);
    });
  });

  it('forwards filters to every page and starts where the caller asks', async () => {
    await withStub(pagedTokens(6, 2), async (server, client) => {
      const tokens = [];
      for await (const token of client.iterateTokens({ pageSize: 2, pageNumber: 2, searchWord: 'dog' })) {
        tokens.push(token);
      }

      assert.deepEqual(
        tokens.map((token) => token.tokenSymbol),
        ['TKN3', 'TKN4', 'TKN5', 'TKN6'],
      );
      for (const request of server.requests) {
        assert.equal(request.query.get('searchWord'), 'dog');
      }
    });
  });

  it('stops on an empty page', async () => {
    await withStub(
      () => ({ body: { tokenList: [], tokenCount: 999 } }),
      async (server, client) => {
        const tokens = [];
        for await (const token of client.iterateTokens()) tokens.push(token);

        assert.equal(tokens.length, 0);
        assert.equal(server.requests.length, 1, 'an empty page ends iteration even if the count lies');
      },
    );
  });

  it('can be stopped early with break, leaving no further requests', async () => {
    await withStub(pagedTokens(100, 2), async (server, client) => {
      for await (const token of client.iterateTokens({ pageSize: 2 })) {
        if (token.id === 3) break;
      }

      assert.equal(server.requests.length, 2);
    });
  });
});
