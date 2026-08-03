/**
 * Conformance tests, driven by `sdk/shared/test-vectors`.
 *
 * The same fixtures back the Go, Python and Rust suites. A change to the wire
 * contract fails all four at once, which is the only thing keeping four
 * hand-written clients honest about the same API.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { FyuzApiError, FyuzNotFoundError, FyuzRateLimitError } from '../src/index.js';
import type { Token } from '../src/index.js';
import { always, withStub } from './support/stub-server.js';
import {
  loadVector,
  type ErrorVector,
  type TokenVector,
  type TradeSideVector,
} from './support/vectors.js';

const MAX_RETRIES = 2;

const tokenVector = loadVector<TokenVector>('token.json');
const errorVector = loadVector<ErrorVector>('http-errors.json');
const tradeSideVector = loadVector<TradeSideVector>('trade-side.json');

/** Serve the shared payload once and return the token the client parsed out of it. */
async function fetchConformanceToken(check: (token: Token) => void): Promise<void> {
  await withStub(always({ body: tokenVector.wire }), async (_server, client) => {
    const page = await client.listTokens();
    assert.equal(page.tokenCount, tokenVector.expect.scalars['tokenCount']);
    assert.equal(page.tokenList.length, 1);
    check(page.tokenList[0] as Token);
  });
}

describe('conformance: token wire contract', () => {
  it('decimal fields survive byte-identical', async () => {
    const exact = Object.entries(tokenVector.expect.exact_strings);
    assert.ok(exact.length > 0, 'fixture has no exact_strings; the test would pass vacuously');

    await fetchConformanceToken((token) => {
      const fields = token as unknown as Record<string, unknown>;
      for (const [name, expected] of exact) {
        assert.equal(
          typeof fields[name],
          'string',
          `${name} is ${typeof fields[name]}, want string — decimals must not be parsed into a number`,
        );
        assert.equal(fields[name], expected.value, `${name}: ${expected.why}`);
      }
    });
  });

  it('the fixture values really are corrupted by float parsing', () => {
    // Without this the vectors could be weakened to float-safe values and the
    // test above would keep passing while protecting nothing. Only the
    // whole-number vectors are checked: comparing them as BigInt is an exact
    // statement about lost digits, with no formatting ambiguity in it.
    const corrupted = Object.entries(tokenVector.expect.exact_strings).filter(
      ([, expected]) =>
        /^\d+$/.test(expected.value) && BigInt(expected.value) !== BigInt(Number(expected.value)),
    );
    assert.ok(
      corrupted.length > 0,
      'no integer vector in exact_strings loses digits through Number() — the fixture proves nothing',
    );
  });

  it('null stays null, because null means unknown and not zero', async () => {
    const { fields: nullable, why } = tokenVector.expect.must_be_null;
    assert.ok(nullable.length > 0, 'fixture has no must_be_null fields');

    await fetchConformanceToken((token) => {
      const fields = token as unknown as Record<string, unknown>;
      for (const name of nullable) {
        assert.equal(fields[name], null, `${name}: ${why}`);
      }
    });
  });

  it('scalars round-trip', async () => {
    const { scalars } = tokenVector.expect;
    await fetchConformanceToken((token) => {
      assert.equal(token.id, scalars['id']);
      assert.equal(token.poolType, scalars['poolType']);
      assert.equal(token.replies, scalars['replies']);
    });
  });
});

describe('conformance: trade side casing', () => {
  // The API sends "buy"/"sell" from /trades/recent and "BUY"/"SELL" from the
  // token detail endpoint. The value is passed through untouched, so a caller
  // has to fold the case — this pins both halves of that contract.
  for (const { wire, side } of tradeSideVector.cases) {
    it(`${wire} is surfaced verbatim and reads as ${side}`, async () => {
      const body = structuredClone(tradeSideVector.wire_template);
      body.trades[0]!['type'] = wire;

      await withStub(always({ body }), async (_server, client) => {
        const { trades } = await client.getRecentTrades();
        const trade = trades[0]!;

        assert.equal(trade.type, wire, 'the SDK must not rewrite what the server sent');
        assert.equal(trade.type.toLowerCase(), side);
      });
    });
  }
});

describe('conformance: HTTP error classification', () => {
  assert.ok(errorVector.cases.length > 0, 'fixture has no cases; the suite would pass vacuously');

  for (const testCase of errorVector.cases) {
    it(`${testCase.status} → ${testCase.classification}, retryable=${testCase.retryable}`, async () => {
      await withStub(
        always({ status: testCase.status, body: testCase.body }),
        async (server, client) => {
          const error = await client.health().then(
            () => undefined,
            (caught: unknown) => caught,
          );

          assert.ok(error instanceof FyuzApiError, `expected FyuzApiError, got ${String(error)}`);
          assert.equal(error.status, testCase.status);

          switch (testCase.classification) {
            case 'not_found':
              assert.ok(error instanceof FyuzNotFoundError);
              break;
            case 'rate_limited':
              assert.ok(error instanceof FyuzRateLimitError);
              break;
            case 'api':
              assert.ok(!(error instanceof FyuzNotFoundError));
              assert.ok(!(error instanceof FyuzRateLimitError));
              break;
          }

          if (testCase.message !== null) {
            assert.equal(error.message, testCase.message);
          } else {
            // A body the SDK cannot parse still has to yield something readable.
            assert.ok(error.message.trim().length > 0);
          }

          assert.equal(
            server.requests.length,
            testCase.retryable ? MAX_RETRIES + 1 : 1,
            `retryable=${testCase.retryable}`,
          );
        },
        { maxRetries: MAX_RETRIES },
      );
    });
  }
});
