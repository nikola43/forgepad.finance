# Shared test vectors

Language-agnostic fixtures that every SDK loads from disk and asserts against, so
the four clients cannot silently drift apart. A change here fails four test suites
at once, which is the point.

| File | Asserts |
|---|---|
| [`test-vectors/token.json`](test-vectors/token.json) | Decimal fields survive the wire byte-identical; nullable fields stay null |
| [`test-vectors/http-errors.json`](test-vectors/http-errors.json) | Status code → error variant, and which statuses are retried |
| [`test-vectors/trade-side.json`](test-vectors/trade-side.json) | `Trade.type` casing differs by endpoint and must compare case-insensitively |
| [`test-vectors/trade-calldata.json`](test-vectors/trade-calldata.json) | Every SDK's hand-rolled ABI encoder produces byte-identical calldata |
| [`test-vectors/trade-errors.json`](test-vectors/trade-errors.json) | Contract revert selector → typed error, and which reverts are worth retrying |

Each SDK has a `conformance` test that serves `wire` from a stub HTTP server,
calls the real client against it, and checks `expect`:

| SDK | Test |
|---|---|
| TypeScript | [`typescript/test/conformance.test.ts`](../typescript/test/conformance.test.ts) |
| Go | [`go/conformance_test.go`](../go/conformance_test.go) |
| Python | [`python/tests/test_conformance.py`](../python/tests/test_conformance.py) |
| Rust | [`rust/tests/conformance.rs`](../rust/tests/conformance.rs) |

## Why these particular numbers

The two invariants worth protecting are both about *not* being clever with values
the server sent:

**Decimal amounts stay strings.** Market caps, token amounts and every `*_wei`
field carry up to 18 decimals and routinely exceed the exact range of an IEEE-754
double. `token.json` picks values that make a float bug visible rather than
subtle — `29999.999999999999999999` rounds to exactly `30000` as a double, and
`30000` is the graduation threshold, so a float-parsing client reports a token as
graduated while it is still on the curve. `9007199254740993` is `2^53 + 1`, the
smallest integer a double cannot hold.

**`null` is not `0`.** A null `liquidity` or `curveHolding` means the on-chain
read failed and the value is *unknown*. A null `pairAddress` means the token has
not graduated and no DEX pool exists anywhere. Zero-defaulting either one renders
something false to a user.

**Calldata is byte-identical or it is a bug.** None of the four SDKs carries an ABI library: every
argument these swap entrypoints take is a static 32-byte word, so encoding is a pinned selector
followed by left-padded values. That is easy to get right and easy to get *subtly* wrong — a padding
side, a missing `0x`, a bool encoded as one byte instead of a word. `trade-calldata.json` was
generated with `cast calldata`, so the expected hex is foundry's output rather than any of these
implementations agreeing with itself. Four hand-rolled encoders matching it is the only reason to
trust any of them.

Selectors are pinned constants because deriving one needs keccak-256, and none of these runtimes
ships it — Node's `sha3-256`, Python's `hashlib.sha3_256` and Go's `crypto/sha3` are all the FIPS
variant, which produces a *different* digest from Ethereum's Keccak-256. Silently using the wrong one
would send transactions to whatever function happened to share those four bytes.

## Adding a vector

Add the case to the JSON, then extend the four conformance tests. If a value only
makes sense in one language it does not belong here — the file's only job is to be
the thing all four agree on.

## Not here

Contract ABIs and deployment addresses. `GET /config` publishes the contract address, chain id, RPC
endpoint and full ABI per chain, and the trading layer reads them from there at runtime. Committing a
second copy would mean a contract upgrade silently stranding four SDKs on a dead address.

The only contract facts pinned in this directory are the ten function selectors and the revert-error
table — both immutable given a signature, and neither derivable at runtime without a keccak-256
implementation none of these SDKs carries.
