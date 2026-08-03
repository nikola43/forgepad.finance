/** Wire-shaped fixtures, copied from the OpenAPI examples. */

import type { PayoutLine, RoundDetail, Token } from '../../src/index.js';

/** A complete `Token` wire record, with decimal-string amounts. */
export function makeToken(id: number): Token {
  return {
    id,
    tokenAddress: `0x${id.toString(16).padStart(40, '0')}`,
    tokenName: `Token ${id}`,
    tokenSymbol: `TKN${id}`,
    tokenDescription: null,
    imageStyle: 'pixel',
    tokenImage: null,
    tokenBanner: null,
    creatorAddress: '0x1111111111111111111111111111111111111111',
    user: { address: '0x1111111111111111111111111111111111111111', username: null, avatar: null },
    network: 'bsc',
    marketcap: '4472.899483094470000000',
    price: '0.000004472899483094',
    ethPrice: '612.120000000000000000',
    volume: '1234.567800000000000000',
    score: '10.5',
    virtualEthAmount: '30.000000000000000000',
    virtualTokenAmount: '1073000000.000000000000000000',
    pairAddress: null,
    poolType: 1,
    category: 'meme',
    replies: 3,
    webLink: null,
    telegramLink: null,
    twitterLink: null,
    launchedAt: null,
    createdAt: '2026-07-01T12:00:00Z',
    updatedAt: '2026-07-02T12:00:00Z',
    creationTime: '2026-07-01T12:00:00Z',
    liquidity: '900.000000000000000000',
    progress: 14.9,
    priceChange: -2.5,
  };
}

/** A payout line with a wei amount that a float cannot represent exactly. */
export function makePayoutLine(overrides: Partial<PayoutLine> = {}): PayoutLine {
  return {
    roundId: 7,
    address: '0x2222222222222222222222222222222222222222',
    share: 2147483648,
    amountWei: '1000000000000000001',
    username: null,
    avatar: null,
    ...overrides,
  };
}

/** A `RoundDetail` exactly as the server flattens it: receipt fields beside `payouts`. */
export function makeRoundDetail(): RoundDetail {
  return {
    roundId: 7,
    timeStart: 1_770_000_000,
    timeEnd: 1_770_600_000,
    txHash: '0xdeadbeef',
    potWei: '2500000000000000001',
    distributedWei: '2250000000000000001',
    winnerAddress: '0x3333333333333333333333333333333333333333',
    winnerAmountWei: '250000000000000000',
    holderCount: 2,
    vrfRandom: '81877094100594700851854016338553178073281748266152893963270277232455373021265',
    distributedAt: 1_770_600_042,
    payouts: [makePayoutLine(), makePayoutLine({ address: '0x4444444444444444444444444444444444444444' })],
  };
}
