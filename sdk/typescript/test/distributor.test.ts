import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { AddressPayouts, Shares } from '../src/index.js';
import { always, withStub } from './support/stub-server.js';
import { makeRoundDetail } from './support/fixtures.js';

describe('distributor', () => {
  it('reads a round detail with the receipt fields flattened beside payouts', async () => {
    const round = makeRoundDetail();

    await withStub(always({ body: round }), async (server, client) => {
      const detail = await client.distributor.getRound(7);

      // Flattened: roundId sits at the top level, not under a `round` key.
      assert.equal(detail.roundId, 7);
      assert.equal(detail.timeStart, 1_770_000_000);
      assert.equal(detail.winnerAddress, '0x3333333333333333333333333333333333333333');
      assert.equal(detail.payouts.length, 2);
      assert.equal(detail.payouts[0]!.roundId, 7);
      assert.equal(Object.hasOwn(detail as object, 'round'), false);
      assert.equal(server.requests[0]!.pathname, '/distributor/rounds/7');
    });
  });

  it('keeps an unsettled round nullable rather than zeroed', async () => {
    await withStub(
      always({
        body: [
          {
            roundId: 8,
            timeStart: 1_770_600_000,
            timeEnd: 1_771_200_000,
            txHash: null,
            potWei: null,
            distributedWei: null,
            winnerAddress: null,
            winnerAmountWei: null,
            holderCount: null,
            vrfRandom: null,
            distributedAt: null,
          },
        ],
      }),
      async (server, client) => {
        const [round] = await client.distributor.listRounds({ limit: 1 });

        assert.equal(round!.potWei, null);
        assert.equal(round!.distributedAt, null);
        assert.notEqual(round!.potWei, '0');
        assert.equal(server.requests[0]!.query.get('limit'), '1');
      },
    );
  });

  it('returns the packed calldata verbatim', async () => {
    const shares: Shares = {
      from: 1_770_000_000,
      to: 1_770_600_000,
      totalPoints: 1234.5,
      holders: [{ address: '0xabc', points: 1000, share: 4_294_967_295 }],
      packed: '0x2222222222222222222222222222222222222222ffffffff',
    };

    await withStub(always({ body: shares }), async (server, client) => {
      const result = await client.distributor.getShares({ from: shares.from, to: shares.to, limit: 100 });

      assert.equal(result.packed, shares.packed);
      assert.equal(result.holders[0]!.share, 4_294_967_295);
      const { query } = server.requests[0]!;
      assert.equal(query.get('from'), '1770000000');
      assert.equal(query.get('to'), '1770600000');
      assert.equal(query.get('limit'), '100');
    });
  });

  it('sums an address ledger without touching the wei strings', async () => {
    const payouts: AddressPayouts = {
      address: '0xabc',
      totalWei: '3000000000000000003',
      roundsPaid: 3,
      payouts: [
        { roundId: 3, address: '0xabc', share: 1, amountWei: '1000000000000000001', username: null, avatar: null },
        { roundId: 2, address: '0xabc', share: 1, amountWei: '1000000000000000001', username: null, avatar: null },
        { roundId: 1, address: '0xabc', share: 1, amountWei: '1000000000000000001', username: null, avatar: null },
      ],
    };

    await withStub(always({ body: payouts }), async (_server, client) => {
      const result = await client.distributor.getPayouts('0xABC');

      const summed = result.payouts.reduce((total, line) => total + BigInt(line.amountWei), 0n);
      assert.equal(summed.toString(), result.totalWei);
      assert.equal(result.roundsPaid, 3);
    });
  });
});
