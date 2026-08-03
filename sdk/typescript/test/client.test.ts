import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FyuzClient, USER_AGENT, type DiscoverToken, type TokenPage } from '../src/index.js';
import { always, withStub } from './support/stub-server.js';
import { makeToken } from './support/fixtures.js';

describe('request shaping', () => {
  it('sends the SDK user agent and an application/json accept header', async () => {
    await withStub(always({ body: { status: 'ok' } }), async (server, client) => {
      const health = await client.health();

      assert.deepEqual(health, { status: 'ok' });
      const request = server.requests[0]!;
      assert.equal(request.method, 'GET');
      assert.equal(request.pathname, '/health');
      assert.equal(request.headers['user-agent'], USER_AGENT);
      assert.equal(request.headers['accept'], 'application/json');
    });
  });

  it('normalises a base URL with a trailing slash', async () => {
    await withStub(
      always({ body: { chains: [{ name: 'BNB Smart Chain', chainId: 56 }] } }),
      async (server) => {
        const client = new FyuzClient({ baseUrl: `${server.url}/` });
        const config = await client.getConfig();

        assert.equal(config.chains[0]?.chainId, 56);
        assert.equal(server.requests[0]!.url, '/config');
      },
    );
  });

  it('serialises discovery filters and drops undefined ones', async () => {
    const row: DiscoverToken = {
      tokenAddress: '0xabc',
      name: 'Doge',
      symbol: 'DOGE',
      image: null,
      network: 'bsc',
      creatorAddress: null,
      marketcap: 12_345.5,
      priceUsd: 0.000012,
      createdAt: 1_770_000_000,
      launched: false,
      volume24h: 900.25,
      buys24h: 12,
      sells24h: 3,
      holders: 40,
      priceChange24h: 8.5,
      graduationPct: 41.15,
    };

    await withStub(always({ body: [row] }), async (server, client) => {
      const tokens = await client.discover({ tab: 'graduating', minHolders: 25, status: 'bonding' });

      assert.equal(tokens.length, 1);
      assert.equal(tokens[0]!.symbol, 'DOGE');
      const { query } = server.requests[0]!;
      assert.equal(query.get('tab'), 'graduating');
      assert.equal(query.get('minHolders'), '25');
      assert.equal(query.get('status'), 'bonding');
      assert.equal(query.has('network'), false);
      assert.equal(query.has('limit'), false);
    });
  });

  it('percent-encodes path parameters', async () => {
    await withStub(
      always({
        body: {
          tokenDetails: makeToken(1),
          trades: [],
          tradesCount: 0,
          holdersDetails: [],
          fifteenMinPrice: null,
          oneDayLiquidity: null,
          curveHolding: null,
        },
      }),
      async (server, client) => {
        const detail = await client.getToken('bsc', '0x23a8/../etc', { pageSize: 5 });

        assert.equal(detail.tokenDetails.tokenSymbol, 'TKN1');
        assert.equal(detail.curveHolding, null, 'null must survive as null, never 0');
        const request = server.requests[0]!;
        assert.equal(request.pathname, '/tokens/bsc/0x23a8%2F..%2Fetc');
        assert.equal(request.query.get('pageSize'), '5');
      },
    );
  });

  it('sends the token address in the body for POST /trades', async () => {
    await withStub(always({ body: [] }), async (server, client) => {
      const trades = await client.getTokenTrades('0xFEED', { limit: 10, offset: 20 });

      assert.deepEqual(trades, []);
      const request = server.requests[0]!;
      assert.equal(request.method, 'POST');
      assert.equal(request.pathname, '/trades');
      assert.equal(request.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(request.body), { tokenAddress: '0xFEED' });
      assert.equal(request.query.get('limit'), '10');
      assert.equal(request.query.get('offset'), '20');
    });
  });

  it('passes the required chart parameters through', async () => {
    await withStub(
      always({ body: [{ time: 1_770_000_000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 42 }] }),
      async (server, client) => {
        const candles = await client.getChartData({
          tokenAddress: '0xabc',
          interval: '5',
          from: 1_770_000_000,
          to: 1_770_003_600,
          countBack: 100,
        });

        assert.equal(candles[0]!.close, 1.5);
        const { query } = server.requests[0]!;
        assert.equal(query.get('tokenAddress'), '0xabc');
        assert.equal(query.get('interval'), '5');
        assert.equal(query.get('from'), '1770000000');
        assert.equal(query.get('to'), '1770003600');
        assert.equal(query.get('countBack'), '100');
      },
    );
  });

  it('returns a typed token page', async () => {
    const page: TokenPage = { tokenList: [makeToken(1), makeToken(2)], tokenCount: 2 };

    await withStub(always({ body: page }), async (server, client) => {
      const result = await client.listTokens({ orderType: 'marketcap', orderFlag: 'desc' });

      assert.equal(result.tokenCount, 2);
      assert.equal(result.tokenList[1]!.tokenSymbol, 'TKN2');
      assert.equal(server.requests[0]!.query.get('orderFlag'), 'desc');
    });
  });

  it('unwraps the king envelope', async () => {
    // GET /tokens/king answers `{"king": ...}`, not a bare token. Handing the
    // envelope back as a Token yields an object whose every field is undefined
    // behind a type that says otherwise.
    const token = makeToken(1);

    await withStub(always({ body: { king: token } }), async (_server, client) => {
      const king = await client.getKing();

      assert.notEqual(king, null);
      assert.equal(king!.tokenSymbol, 'TKN1');
      assert.equal(king!.marketcap, token.marketcap);
    });
  });

  it('returns null when no token is on the hill', async () => {
    // A real state, not an error: a token leaves the hill when it graduates.
    await withStub(always({ body: { king: null } }), async (_server, client) => {
      assert.equal(await client.getKing(), null);
    });
  });

  it('merges per-request headers over the client defaults', async () => {
    await withStub(
      always({ body: { status: 'ok' } }),
      async (server, client) => {
        await client.health({ headers: { 'x-trace-id': 'abc123' } });
        assert.equal(server.requests[0]!.headers['x-trace-id'], 'abc123');
        assert.equal(server.requests[0]!.headers['x-client'], 'test-suite');
      },
      { headers: { 'x-client': 'test-suite' } },
    );
  });
});
