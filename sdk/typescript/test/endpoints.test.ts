/**
 * Every method hits the path and verb the OpenAPI spec declares. This is the
 * cheap regression net against a rename or a typo'd path.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import type { FyuzClient } from '../src/index.js';
import { withStub } from './support/stub-server.js';

interface Case {
  name: string;
  call: (client: FyuzClient) => Promise<unknown>;
  method: string;
  path: string;
  /** Response body the stub returns; defaults to `{}`. */
  body?: unknown;
}

const ADDRESS = '0x2222222222222222222222222222222222222222';

const CASES: Case[] = [
  { name: 'health', call: (c) => c.health(), method: 'GET', path: '/health' },
  { name: 'getConfig', call: (c) => c.getConfig(), method: 'GET', path: '/config' },
  { name: 'discover', call: (c) => c.discover(), method: 'GET', path: '/discover', body: [] },
  { name: 'listTokens', call: (c) => c.listTokens(), method: 'GET', path: '/tokens' },
  { name: 'getKing', call: (c) => c.getKing(), method: 'GET', path: '/tokens/king' },
  {
    name: 'getToken',
    call: (c) => c.getToken('bsc', '0xabc'),
    method: 'GET',
    path: '/tokens/bsc/0xabc',
  },
  {
    name: 'getRecentTrades',
    call: (c) => c.getRecentTrades({ latestTradeId: 5 }),
    method: 'GET',
    path: '/trades/recent',
  },
  {
    name: 'getTokenTrades',
    call: (c) => c.getTokenTrades('0xabc'),
    method: 'POST',
    path: '/trades',
    body: [],
  },
  {
    name: 'getChartData',
    call: (c) => c.getChartData({ tokenAddress: '0xabc', interval: '5', from: 1, to: 2 }),
    method: 'GET',
    path: '/trades/getChartData',
    body: [],
  },
  {
    name: 'getTokenAnalytics',
    call: (c) => c.getTokenAnalytics('bsc', '0xabc'),
    method: 'GET',
    path: '/analytics/token/bsc/0xabc',
  },
  {
    name: 'getTopTraders',
    call: (c) => c.getTopTraders('bsc', '0xabc'),
    method: 'GET',
    path: '/analytics/top-traders/bsc/0xabc',
    body: [],
  },
  { name: 'getWallet', call: (c) => c.getWallet(ADDRESS), method: 'GET', path: `/wallet/${ADDRESS}` },
  {
    name: 'getPortfolio',
    call: (c) => c.getPortfolio(ADDRESS),
    method: 'GET',
    path: `/portfolio/${ADDRESS}`,
  },
  {
    name: 'getUserLeaderboard',
    call: (c) => c.getUserLeaderboard({ limit: 10 }),
    method: 'GET',
    path: '/users/leaderboard',
    body: [],
  },
  {
    name: 'getUserProfile',
    call: (c) => c.getUserProfile(ADDRESS),
    method: 'GET',
    path: `/users/profile/${ADDRESS}`,
  },
  {
    name: 'getTopHolders',
    call: (c) => c.getTopHolders(25, { from: 0 }),
    method: 'GET',
    path: '/users/top/25',
    body: [],
  },
  { name: 'getKingsHistory', call: (c) => c.getKingsHistory(), method: 'GET', path: '/kings/history', body: [] },
  { name: 'getSeason', call: (c) => c.getSeason(), method: 'GET', path: '/season' },
  {
    name: 'getReferralLeaderboard',
    call: (c) => c.getReferralLeaderboard(),
    method: 'GET',
    path: '/referrals/leaderboard',
    body: [],
  },
  { name: 'getTier', call: (c) => c.getTier(ADDRESS), method: 'GET', path: `/tier/${ADDRESS}` },
  { name: 'getRewards', call: (c) => c.getRewards(ADDRESS), method: 'GET', path: `/rewards/${ADDRESS}` },
  {
    name: 'distributor.getStats',
    call: (c) => c.distributor.getStats(),
    method: 'GET',
    path: '/distributor/stats',
  },
  { name: 'distributor.getPot', call: (c) => c.distributor.getPot(), method: 'GET', path: '/distributor/pot' },
  {
    name: 'distributor.getShares',
    call: (c) => c.distributor.getShares({ limit: 100 }),
    method: 'GET',
    path: '/distributor/shares',
  },
  {
    name: 'distributor.listRounds',
    call: (c) => c.distributor.listRounds({ limit: 25, offset: 0 }),
    method: 'GET',
    path: '/distributor/rounds',
    body: [],
  },
  {
    name: 'distributor.getRound',
    call: (c) => c.distributor.getRound(7),
    method: 'GET',
    path: '/distributor/rounds/7',
  },
  {
    name: 'distributor.getPayouts',
    call: (c) => c.distributor.getPayouts(ADDRESS),
    method: 'GET',
    path: `/distributor/payouts/${ADDRESS}`,
  },
  {
    name: 'distributor.getClaimable',
    call: (c) => c.distributor.getClaimable(ADDRESS),
    method: 'GET',
    path: `/distributor/claimable/${ADDRESS}`,
  },
];

describe('endpoint coverage', () => {
  it('covers all 28 documented endpoints', () => {
    assert.equal(CASES.length, 28);
  });

  for (const testCase of CASES) {
    it(`${testCase.name} calls ${testCase.method} ${testCase.path}`, async () => {
      await withStub(
        () => ({ body: testCase.body ?? {} }),
        async (server, client) => {
          await testCase.call(client);

          const request = server.requests[0]!;
          assert.equal(request.method, testCase.method);
          assert.equal(request.pathname, testCase.path);
        },
      );
    });
  }
});
