/**
 * The whole reason amounts are typed as strings: an IEEE-754 double cannot hold
 * an 18-decimal token amount or a uint256 wei value exactly. These tests fail the
 * day someone "helpfully" widens one of those fields to `number`.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { PayoutStats, Token } from '../src/index.js';
import { always, withStub } from './support/stub-server.js';
import { makeRoundDetail, makeToken } from './support/fixtures.js';

const HUGE_WEI = '123456789012345678901234567890';
const EXACT_MARKETCAP = '4472.899483094470000000';

describe('decimal precision', () => {
  it('round-trips a wei value that a float would corrupt', async () => {
    const stats: PayoutStats = {
      totalPaidWei: HUGE_WEI,
      roundsSettled: 42,
      uniqueRecipients: 391,
      largestPayoutWei: '1000000000000000001',
      lastRoundAt: 1_770_600_042,
    };

    await withStub(always({ body: stats }), async (_server, client) => {
      const result = await client.distributor.getStats();

      assert.equal(result.totalPaidWei, HUGE_WEI);
      assert.equal(typeof result.totalPaidWei, 'string');
      assert.equal(BigInt(result.totalPaidWei).toString(), HUGE_WEI);
      assert.equal(result.largestPayoutWei, '1000000000000000001');

      // Proof that the string is not decoration: a float loses both values.
      assert.notEqual(String(Number(result.totalPaidWei)), HUGE_WEI);
      assert.notEqual(String(Number(result.largestPayoutWei)), '1000000000000000001');
    });
  });

  it('keeps 18-decimal token amounts as exact strings', async () => {
    const token: Token = makeToken(1);

    await withStub(
      always({ body: { tokenList: [token], tokenCount: 1 } }),
      async (_server, client) => {
        const page = await client.listTokens();
        const received = page.tokenList[0]!;

        assert.equal(received.marketcap, EXACT_MARKETCAP);
        assert.equal(received.virtualTokenAmount, '1073000000.000000000000000000');
        assert.equal(typeof received.price, 'string');

        // The trailing zeros are meaningful and a float would drop them.
        assert.notEqual(String(Number(received.marketcap)), EXACT_MARKETCAP);
      },
    );
  });

  it('keeps payout amounts and the VRF word exact', async () => {
    const round = makeRoundDetail();

    await withStub(always({ body: round }), async (_server, client) => {
      const detail = await client.distributor.getRound(7);

      assert.equal(detail.payouts[0]!.amountWei, '1000000000000000001');
      assert.equal(BigInt(detail.payouts[0]!.amountWei) - 1n, 1_000_000_000_000_000_000n);
      assert.equal(detail.vrfRandom, round.vrfRandom);
      assert.equal(typeof detail.vrfRandom, 'string');
      assert.equal(BigInt(detail.vrfRandom!).toString(), round.vrfRandom);
    });
  });

  it('preserves null as null — never as zero', async () => {
    await withStub(
      always({
        body: { potBnb: null, distributeBps: 9000, roundEnd: 1_770_600_000, totalPoints: null, pointsPerUsd: 1 },
      }),
      async (_server, client) => {
        const pot = await client.distributor.getPot();

        assert.equal(pot.potBnb, null);
        assert.equal(pot.totalPoints, null);
        assert.notEqual(pot.potBnb, 0);
        assert.equal(pot.distributeBps, 9000);
      },
    );
  });

  it('preserves a null claimable balance', async () => {
    await withStub(
      always({ body: { address: '0xabc', claimableWei: null, distributorAddress: null } }),
      async (_server, client) => {
        const claimable = await client.distributor.getClaimable('0xABC');

        assert.equal(claimable.claimableWei, null, 'null means unknown, not "nothing owed"');
        assert.equal(claimable.distributorAddress, null);
      },
    );
  });
});
