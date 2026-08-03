/**
 * Trading: calldata encoding, quotes, slippage, and revert classification.
 *
 * The encoding half is driven by `shared/test-vectors/trade-calldata.json`,
 * whose expected hex came out of `cast calldata`. Four hand-written ABI encoders
 * agreeing with foundry is the only reason to trust any of them.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  FyuzContractRevertError,
  FyuzInvalidArgumentError,
  FyuzTokenGraduatedError,
  formatUnits,
  parseUnits,
  revertError,
} from '../src/index.js';
import {
  startChainStub,
  swapOutputResult,
  tokenPoolsResult,
  word,
} from './support/chain-stub.js';
import { loadVector, type CalldataVector, type TradeErrorVector } from './support/vectors.js';

const calldataVector = loadVector<CalldataVector>('trade-calldata.json');
const errorVector = loadVector<TradeErrorVector>('trade-errors.json');

const TOKEN = calldataVector.fixture_args.token;
const DEADLINE = calldataVector.fixture_args.deadline;

const SEL_SWAP_EXACT_ETH = '0x6bf05b01';
const SEL_SWAP_ETH_EXACT = '0x0541a872';
const SEL_SWAP_TOKENS_ETH = '0xeacad12a';
const SEL_QUOTE = '0x908235cc';
const SEL_FIRST_FEE = '0xb3cd4902';
const SEL_POOLS = '0xc3d2c3c1';
const SEL_APPROVE = '0x095ea7b3';
const SEL_ALLOWANCE = '0xdd62ed3e';

/** The case from the shared fixture with this name. */
function fixture(name: string): CalldataVector['cases'][number] {
  const found = calldataVector.cases.find((entry) => entry.name === name);
  assert.ok(found !== undefined, `fixture ${name} missing from trade-calldata.json`);
  return found;
}

describe('trade: calldata matches the shared golden vectors', () => {
  it('buy_exact_bnb', async () => {
    const expected = fixture('buy_exact_bnb');
    const stub = await startChainStub({
      results: {
        // amountOut is exactly the fixture's minAmountOut, so 0 bps slippage
        // reproduces the golden calldata without any rounding in the way.
        [SEL_QUOTE]: swapOutputResult(BigInt(expected.args['minAmountOut'] as string), 120),
        [SEL_FIRST_FEE]: `0x${word(0)}`,
      },
    });

    try {
      const built = await stub.client.trade.buildBuy({
        token: TOKEN,
        amountWei: String(expected.args['buyAmount']),
        slippageBps: 0,
        deadline: DEADLINE,
      });

      assert.equal(built.transaction.data, expected.calldata);
      assert.equal(built.transaction.to, calldataVector.contract.bsc);
      assert.equal(built.transaction.chainId, calldataVector.contract.chainId);
      // value carries the first-buy fee on top of the amount; the fee is 0 here.
      assert.equal(built.transaction.value, `0x${BigInt(expected.args['buyAmount'] as string).toString(16)}`);
    } finally {
      await stub.close();
    }
  });

  it('sell_exact_tokens', async () => {
    const expected = fixture('sell_exact_tokens');
    const stub = await startChainStub({
      results: {
        [SEL_QUOTE]: swapOutputResult(BigInt(expected.args['minAmountOut'] as string), 90),
      },
    });

    try {
      const built = await stub.client.trade.buildSell({
        token: TOKEN,
        amountWei: String(expected.args['sellAmount']),
        slippageBps: 0,
        deadline: DEADLINE,
      });

      assert.equal(built.transaction.data, expected.calldata);
      assert.equal(built.transaction.value, '0x0', 'selling is not payable');
    } finally {
      await stub.close();
    }
  });

  it('buy_exact_tokens', async () => {
    const expected = fixture('buy_exact_tokens');
    const stub = await startChainStub({
      results: {
        [SEL_QUOTE]: swapOutputResult(BigInt(expected.args['maxAmountIn'] as string), 0),
        [SEL_FIRST_FEE]: `0x${word(0)}`,
      },
    });

    try {
      const built = await stub.client.trade.buildBuyExactTokens({
        token: TOKEN,
        amountOutWei: String(expected.args['buyAmount']),
        slippageBps: 0,
        deadline: DEADLINE,
      });

      assert.equal(built.transaction.data, expected.calldata);
    } finally {
      await stub.close();
    }
  });

  it('approve_exact and approve_unlimited', async () => {
    const exact = fixture('approve_exact');
    const unlimited = fixture('approve_unlimited');
    const stub = await startChainStub();

    try {
      const approveExact = await stub.client.trade.buildApprove({
        token: TOKEN,
        amountWei: String(exact.args['amount']),
      });
      assert.equal(approveExact.data, exact.calldata);
      assert.equal(approveExact.to, TOKEN, 'approve targets the token, not the curve');

      const approveMax = await stub.client.trade.buildApprove({ token: TOKEN, unlimited: true });
      assert.equal(approveMax.data, unlimited.calldata);
    } finally {
      await stub.close();
    }
  });

  it('quote_buy and quote_sell', async () => {
    const stub = await startChainStub({
      results: { [SEL_QUOTE]: swapOutputResult(1n, 1), [SEL_FIRST_FEE]: `0x${word(0)}` },
    });

    try {
      await stub.client.trade.quoteBuy({
        token: TOKEN,
        amountWei: String(fixture('quote_buy').args['amountIn']),
      });
      await stub.client.trade.quoteSell({
        token: TOKEN,
        amountWei: String(fixture('quote_sell').args['amountIn']),
      });

      const quoteCalls = stub.calls.filter((call) => call.data.startsWith(SEL_QUOTE));
      assert.equal(quoteCalls[0]?.data, fixture('quote_buy').calldata);
      assert.equal(quoteCalls[1]?.data, fixture('quote_sell').calldata);
    } finally {
      await stub.close();
    }
  });

  it('allowance', async () => {
    const expected = fixture('allowance');
    const stub = await startChainStub({ results: { [SEL_ALLOWANCE]: `0x${word(42)}` } });

    try {
      const result = await stub.client.trade.allowance({
        token: TOKEN,
        owner: String(expected.args['owner']),
      });
      assert.equal(result, '42');

      const call = stub.calls.find((entry) => entry.data.startsWith(SEL_ALLOWANCE));
      assert.equal(call?.data, expected.calldata);
    } finally {
      await stub.close();
    }
  });

  it('token_pools, and a mixed-case address encodes lower-cased', async () => {
    const expected = fixture('token_pools');
    const stub = await startChainStub({ results: { [SEL_POOLS]: tokenPoolsResult(false) } });

    try {
      assert.equal(await stub.client.trade.isGraduated({ token: TOKEN.toUpperCase().replace('0X', '0x') }), false);
      const call = stub.calls.find((entry) => entry.data.startsWith(SEL_POOLS));
      assert.equal(call?.data, expected.calldata);
      assert.ok(
        expected.calldata.includes(calldataVector.address_casing.encoded_word.slice(24)) ||
          call?.data.slice(10).endsWith(TOKEN.slice(2).toLowerCase()),
      );
    } finally {
      await stub.close();
    }
  });

  it('every selector in the fixture matches what the SDK encodes', () => {
    // Catches a mistyped constant, which would otherwise send a transaction to
    // whatever function happened to share the wrong four bytes.
    const expected = calldataVector.selectors;
    assert.equal(expected['swapExactETHForTokens(address,uint256,uint256,uint256)'], SEL_SWAP_EXACT_ETH);
    assert.equal(expected['swapETHForExactTokens(address,uint256,uint256,uint256)'], SEL_SWAP_ETH_EXACT);
    assert.equal(expected['swapExactTokensForETH(address,uint256,uint256,uint256)'], SEL_SWAP_TOKENS_ETH);
    assert.equal(expected['getSwapOutput(address,uint256,bool)'], SEL_QUOTE);
    assert.equal(expected['getFirstBuyFee(address)'], SEL_FIRST_FEE);
    assert.equal(expected['tokenPools(address)'], SEL_POOLS);
    assert.equal(expected['approve(address,uint256)'], SEL_APPROVE);
    assert.equal(expected['allowance(address,address)'], SEL_ALLOWANCE);
  });
});

describe('trade: quotes', () => {
  it('adds the first-buy fee to value but not to the amount swapped', async () => {
    const stub = await startChainStub({
      results: {
        [SEL_QUOTE]: swapOutputResult(1_000n, 250),
        [SEL_FIRST_FEE]: `0x${word(7_000_000_000_000_000n)}`,
      },
    });

    try {
      const quote = await stub.client.trade.quoteBuy({ token: TOKEN, amountWei: parseUnits('0.5') });

      assert.equal(quote.amountInWei, '500000000000000000');
      assert.equal(quote.firstBuyFeeWei, '7000000000000000');
      assert.equal(quote.valueWei, '507000000000000000');
      assert.equal(quote.amountOutWei, '1000');
      assert.equal(quote.priceImpactBps, 250);
    } finally {
      await stub.close();
    }
  });

  it('refuses a graduated token instead of letting it revert on-chain', async () => {
    const stub = await startChainStub({
      reverts: { [SEL_QUOTE]: errorVector.graduated_selector },
    });

    try {
      const error = await stub.client.trade
        .buildBuy({ token: TOKEN, amountWei: parseUnits('0.5'), slippageBps: 100 })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      assert.ok(error instanceof FyuzTokenGraduatedError, `got ${String(error)}`);
      assert.equal(error.kind, 'graduated');
      assert.equal(error.tokenAddress, TOKEN);
      assert.match(error.message, /graduated/);
    } finally {
      await stub.close();
    }
  });
});

describe('trade: slippage', () => {
  it('lowers minAmountOut by the tolerance on a buy', async () => {
    const stub = await startChainStub({
      results: { [SEL_QUOTE]: swapOutputResult(1_000_000n, 100), [SEL_FIRST_FEE]: `0x${word(0)}` },
    });

    try {
      const built = await stub.client.trade.buildBuy({
        token: TOKEN,
        amountWei: parseUnits('1'),
        slippageBps: 100, // 1%
      });
      assert.equal(built.limitWei, '990000');
    } finally {
      await stub.close();
    }
  });

  it('raises maxAmountIn by the tolerance on an exact-tokens buy', async () => {
    const stub = await startChainStub({
      results: { [SEL_QUOTE]: swapOutputResult(1_000_000n, 0), [SEL_FIRST_FEE]: `0x${word(0)}` },
    });

    try {
      const built = await stub.client.trade.buildBuyExactTokens({
        token: TOKEN,
        amountOutWei: '5000',
        slippageBps: 250, // 2.5%
      });
      assert.equal(built.limitWei, '1025000');
    } finally {
      await stub.close();
    }
  });

  it('refuses to pick a tolerance for you', async () => {
    const stub = await startChainStub({
      results: { [SEL_QUOTE]: swapOutputResult(1_000n, 0), [SEL_FIRST_FEE]: `0x${word(0)}` },
    });

    try {
      const error = await stub.client.trade
        .buildBuy({ token: TOKEN, amountWei: parseUnits('1') })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );

      assert.ok(error instanceof FyuzInvalidArgumentError, `got ${String(error)}`);
      assert.match(error.message, /slippage protection is required/);
    } finally {
      await stub.close();
    }
  });

  it('rejects both slippageBps and limitWei together', async () => {
    const stub = await startChainStub({
      results: { [SEL_QUOTE]: swapOutputResult(1_000n, 0), [SEL_FIRST_FEE]: `0x${word(0)}` },
    });

    try {
      await assert.rejects(
        stub.client.trade.buildBuy({
          token: TOKEN,
          amountWei: parseUnits('1'),
          slippageBps: 100,
          limitWei: '900',
        }),
        /not both/,
      );
    } finally {
      await stub.close();
    }
  });
});

describe('trade: revert classification matches the shared table', () => {
  for (const testCase of errorVector.decode_cases) {
    it(testCase.name, () => {
      const error = revertError(testCase.revert_data, 'getSwapOutput(0x…)');

      assert.ok(error instanceof FyuzContractRevertError);
      assert.equal(error.kind, testCase.expect.surfaced_as);
      if (testCase.expect.error !== undefined) {
        assert.equal(error.errorName, testCase.expect.error);
      }
      if (testCase.expect.message !== undefined) {
        assert.ok(
          error.message.includes(testCase.expect.message),
          `${error.message} should contain ${testCase.expect.message}`,
        );
      }
      if (testCase.expect.message_contains !== undefined) {
        assert.ok(error.message.includes(testCase.expect.message_contains));
      }
    });
  }

  it('every revertible selector in the table is recognised', () => {
    for (const entry of errorVector.revertible) {
      const error = revertError(entry.selector, 'call');
      assert.equal(error.kind, entry.surfaced_as, entry.error);
      assert.equal(error.errorName, entry.error);
      assert.equal(error.retryable, entry.retryable, entry.error);
    }
  });
});

describe('trade: unit conversion', () => {
  it('parseUnits and formatUnits round-trip without touching a float', () => {
    assert.equal(parseUnits('0.5'), '500000000000000000');
    assert.equal(parseUnits('1'), '1000000000000000000');
    assert.equal(parseUnits('0.000000000000000001'), '1');
    // 0.1 + 0.2 in binary floating point is the classic wrong answer; this path
    // never converts to a double, so it is not.
    assert.equal(parseUnits('0.30000000000000004'), '300000000000000040');

    assert.equal(formatUnits('500000000000000000'), '0.5');
    assert.equal(formatUnits('1000000000000000000'), '1');
    assert.equal(formatUnits('1'), '0.000000000000000001');
  });

  it('rejects a decimal string where wei was expected', async () => {
    const stub = await startChainStub();
    try {
      await assert.rejects(
        stub.client.trade.quoteBuy({ token: TOKEN, amountWei: '0.5' }),
        /parseUnits/,
      );
    } finally {
      await stub.close();
    }
  });

  it('refuses more decimal places than the token carries', () => {
    assert.throws(() => parseUnits('1.0000000000000000001'), /more than the 18/);
  });

  it('rejects an address that is not 20 bytes', async () => {
    const stub = await startChainStub();
    try {
      await assert.rejects(
        stub.client.trade.quoteBuy({ token: '0xdead', amountWei: '1' }),
        /20-byte address/,
      );
    } finally {
      await stub.close();
    }
  });
});
