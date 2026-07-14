# Fyuz Phase 1 — Implementation Plan

Response to the Phase 1 platform rules spec. Answers the five open items, then lays out the build.

**Reference price: BNB = $579.14** (spot, 2026-07-14). Every USD figure below derives from it. The
protocol constants are BNB-denominated and do not depend on it — only the USD columns move.

---

## 0. Where we are today

The `fyuz-bsc` branch contains **no Fyuz code yet**. What it does contain is **Arrowpad** — a
production-hardened pump.fun-style launchpad that already implements ~80% of this spec:

| Spec rule | Arrowpad today | Work needed |
|---|---|---|
| Fixed 1B supply | `TOTAL_SUPPLY = 1_000_000_000e18` | none |
| No mint after launch | `Token.sol` mints once in constructor, has no `mint()`, renounces ownership on `launch()` | none |
| Exponential curve | virtual-reserve constant product (the pump.fun curve) | derive V per token at creation (§1) |
| Mandatory first buy | `createToken` accepts an optional `buyAmount` | make it mandatory + enforce a $10 floor |
| 1% trading fee | 1% platform fee exists | restructure the split |
| Creator fee share | `TOKEN_OWNER_FEE_BPS` exists | fold into the 1% instead of adding to it |
| Referral share | — | new, ~15 lines |
| Graduation | triggers on **USD market cap** via Chainlink | switch to **real BNB reserve** (spec §6) |
| Chainlink oracle | wired, hardened, but ETH/USD feeds | keep; repoint to BSC BNB/USD, rescope (§3a) |
| LP burned not locked | LP tokens sent to `0xdEaD` | none |
| No platform token allocation | none exists | none |
| Multisig governance | `Ownable` + 24h timelocks on the dangerous paths | hand owner to a Safe, add fee caps |

Baseline health: **82 tests passing, 0 failing** (`forge test`, 11s). The contracts have already been
through a security pass (commit `7713809`: oracle staleness, overcharge, precision, poolType).

So Phase 1 is a **re-parameterization and simplification of Arrowpad**, not a new protocol. That
framing is what makes the timeline below realistic.

---

## 1. Curve calibration — starting price and steepness

**Proposed constants:**

| Constant | Value | Meaning |
|---|---|---|
| `TOTAL_SUPPLY` | 1,000,000,000 | fixed, per spec |
| `VIRTUAL_TOKEN_INITIAL` (T) | 1,073,000,000 | virtual token reserve — sets curve steepness |
| `REAL_TOKEN_INITIAL` (R) | 793,100,000 | tokens sellable on the curve (79.31%) |
| `GRADUATION_USD` | **$25,000** | USD value of the real BNB reserve that graduates a token |
| `virtualBnbReserve` (V) | **derived per token at creation** | ≈ 15.23 BNB at BNB $579.14 |
| `graduationReserve` (G) | **derived per token at creation** | ≈ 43.17 BNB at BNB $579.14 |
| LP allocation | 206,900,000 | the 20.69% left over, paired with the reserve at graduation |

The curve is `x·y = k` on *virtual* reserves — the standard pump.fun construction. It is exponential
in the sense the spec asks for: price rises increasingly steeply as supply is bought. Concretely,
the first half of the curve costs ~21% of the reserve and the last 10% costs ~30%.

T and R are pump.fun's ratios, kept deliberately (see "why these ratios" below). **V and G are not
constants — they are computed per token at creation from the live oracle price**, so that every token
graduates at $25,000 regardless of what BNB is worth on its launch day:

```solidity
// once, at createToken(), from Chainlink BNB/USD
uint256 price = getBnbPrice();                          // reverts if stale — see §3a
uint256 G = GRADUATION_USD * 1e18 / price;              // ≈ 43.17 BNB at $579.14
uint256 V = Math.ceilDiv(G * (T - R), R);               // ≈ 15.23 BNB  — ceil, see "the trap" below
pool.virtualBnbReserve  = V;                            // snapshotted, immutable for this token's life
pool.graduationReserve  = G;
```

**This is what makes the USD anchor work.** A single hardcoded V would peg graduation to a fixed BNB
amount whose USD value drifts with the market — which is the objection that prompted this design. By
deriving V at creation, the USD economics are identical for every token ever launched:

| BNB at creation | `graduationReserve` | `V` | Start FDV | Graduation FDV | LP price gap |
|---:|---:|---:|---:|---:|---:|
| $300 | 83.33 BNB | 29.41 | $8,223 | $120,839 | −0.007% |
| $450 | 55.56 BNB | 19.61 | $8,223 | $120,839 | −0.007% |
| **$579.14 (today)** | **43.17 BNB** | **15.23** | **$8,223** | **$120,839** | **−0.007%** |
| $700 | 35.71 BNB | 12.60 | $8,223 | $120,839 | −0.007% |
| $1000 | 25.00 BNB | 8.82 | $8,223 | $120,839 | −0.007% |

Every token starts at an $8,223 FDV and graduates at $120,839, always. A token launched in a bear
market and one launched in a bull market are the same product. That consistency is worth more than
any individual parameter choice here, and it is only achievable with a per-token V.

The cost is one extra `uint256` in `PoolInfo` and one oracle read per creation. `virtualBnbReserve`
is *already* per-token state in Arrowpad (`PoolInfo.virtualEthReserve`) — it is only ever initialised
from a constant today. So this is a change to one initialiser plus one new field, not new machinery.

**Resulting curve for a token created today** (BNB $579.14 → V = 15.2346, G = 43.1675):

| Curve sold | Tokens sold | Real BNB reserve | USD reserve | FDV |
|---:|---:|---:|---:|---:|
| 0% | 0 | 0.00 | $0 | $8,223 |
| 5% | 39,655,000 | 0.58 | $339 | $8,866 |
| 10% | 79,310,000 | 1.22 | $704 | $9,588 |
| 20% | 158,620,000 | 2.64 | $1,531 | $11,323 |
| 30% | 237,930,000 | 4.34 | $2,514 | $13,576 |
| 40% | 317,240,000 | 6.39 | $3,704 | $16,575 |
| 50% | 396,550,000 | 8.93 | $5,172 | $20,689 |
| 60% | 475,860,000 | 12.14 | $7,031 | $26,550 |
| 70% | 555,170,000 | 16.33 | $9,459 | $35,305 |
| 80% | 634,480,000 | 22.04 | $12,766 | $49,231 |
| 90% | 713,790,000 | 30.27 | $17,532 | $73,370 |
| 95% | 753,445,000 | 35.92 | $20,803 | $92,709 |
| 99% | 785,169,000 | 41.56 | $24,068 | $114,272 |
| **100%** | **793,100,000** | **43.17** | **$25,000** | **$120,839** |

Price runs **1.420e-8 → 2.087e-7 BNB/token, a 14.7× move** from first buy to graduation. The 14.7×,
the FDV endpoints, and the shape of this table are **invariant across BNB price** — only the BNB
column rescales. A token created at BNB $300 has the identical USD table with G = 83.33 BNB.

**Why these T/R ratios, specifically.** They make the migration price gap vanish *by construction*.
The 206,900,000 leftover tokens paired with the accumulated reserve open the PancakeSwap pool at a
**−0.007% gap** to the curve's final price. Traders see no step change at migration, and no MEV bot
gets a free arbitrage on the discontinuity.

Crucially, **this identity depends only on T, R, and TOTAL_SUPPLY — not on V**. It reduces to
`2RT − R² ≈ T·TOTAL_SUPPLY`, which pump.fun's ratios satisfy to within 0.0014%. That is exactly why
scaling V per token (above) is safe: the zero-gap property survives every BNB price, as the right-hand
column of the calibration table shows. Re-deriving these ratios from scratch would buy nothing and
would risk reintroducing the gap.

**Residual BNB exposure.** Calibration is snapshotted at creation, so a token's graduation USD is
exact on its launch day and then drifts with BNB over its trading life:

| BNB when it graduates (token created at $579.14) | Actual graduation USD | |
|---:|---:|---|
| $400 | $17,267 | outside band |
| $500 | $21,584 | in band |
| **$579.14 (unchanged)** | **$25,000** | **on target** |
| $650 | $28,059 | in band |
| $750 | $32,376 | outside band |

**The band holds for any BNB move within −20%/+20% of the creation price** ($463–$695). Since tokens
on this curve graduate in hours to days, not months, that is comfortable headroom. Eliminating this
residual entirely would require a live-USD trigger, which is not viable — see the trap below.

**Mandatory $10 first buy** on this curve: 0.0173 BNB buys **1,202,632 tokens = 0.120% of supply**.
Small enough that it is not a stealth creator allocation, large enough to cost a spam bot real money.

### The trap: a live-USD trigger bricks tokens

This is the single most important finding in the plan, and it is why graduation reads a *snapshotted*
threshold rather than pricing the reserve live on every trade.

A curve's reserve is bounded. It can never accumulate more than `Emax = V·R/(T−R)` BNB, because that
is the point at which every sellable token is gone. If the graduation threshold is computed live —
`ethReserve × bnbPrice ≥ $25,000` — then **any BNB drop below the creation-time price pushes the
target above `Emax`, and the token can never graduate.** It trades forever, just under the line, with
its liquidity permanently trapped on the curve. There is no recovery path: the tokens are sold out,
so no further buy can move the reserve.

With the earlier fixed V = 14.82, `Emax` = 41.99 BNB = **$24,320 today** — so a live $25,000
threshold is **already unreachable at the current BNB price**, not merely at some hypothetical future
one. Every token launched would brick on day one.

Two properties together make this safe:

1. **V is derived from G at creation**, so `Emax ≥ G` by construction, at any BNB price.
2. **G is snapshotted, not live**, so the finish line cannot move underneath a token that is already
   trading — which also closes the governance rug vector in §6.

**Use `ceilDiv` when deriving V.** With floor division, `V = G·(T−R)/R` truncates, making `Emax`
land a few wei *below* G and reintroducing the same unreachability — a bug that would pass every
normal test and strand the last buyer of every token. Rounding V up guarantees `Emax ≥ G`.

This gets a dedicated invariant test asserting `graduationReserve ≤ virtualBnbReserve·R/(T−R)` at
creation, fuzzed across the full plausible BNB range ($50–$5,000).

---

## 2. Fee split — is Option B feasible?

**Yes. Build Option B.** On-chain referral attribution is roughly 15 lines and one storage slot.

```solidity
mapping(address => address) public referrerOf;   // trader => referrer, set once, permanent

// on every trade, before fee accounting:
if (referrerOf[msg.sender] == address(0) && referrer != address(0) && referrer != msg.sender) {
    referrerOf[msg.sender] = referrer;           // sticky forever
}
address ref = referrerOf[msg.sender];
uint256 refFee = ref == address(0) ? 0 : fee * 10 / 100;   // 0.1% of the trade
treasury += fee - refFee - creatorFee;                     // 0.8% or 0.7%
```

Fee structure, replacing Arrowpad's additive `PLATFORM_FEE + TOKEN_OWNER_FEE` (which would total
1.2%, not 1%):

| Recipient | With referrer | Without referrer |
|---|---|---|
| Creator | 0.2% | 0.2% |
| Referral | 0.1% | — |
| Fyuz treasury | 0.7% | 0.8% |
| **Total** | **1.0%** | **1.0%** |

The 1% total is deducted once and split three ways — it never grows.

**What Option B honestly costs:**
- ~20k extra gas on a trader's *first* ever trade (one `SSTORE`). Zero on every trade after.
- One extra `address referrer` calldata param on the buy/sell entrypoints. Frontend reads it from
  the `?ref=` link; pass `address(0)` when there is none.
- ~4 extra tests.

**What it does not solve, and cannot:** self-referral. Anyone can refer themselves from a second
wallet for a 0.1% rebate. This is unpreventable on-chain (wallets are free) and not worth fighting —
0.1% is below the noise floor of BSC gas. Every referral program on every chain has this. Do not
build Sybil resistance for it.

Recommendation: **Option B**, with the referral share falling back to treasury when unattributed. It
is cheap enough now that deferring it and doing a contract migration later would cost strictly more.

---

## 3. Exact graduation threshold

**`GRADUATION_USD = $25,000`** — the round midpoint of the agreed $20k–$30k range.

Because the curve is calibrated per token from the oracle price (§1), the threshold no longer has to
hedge against BNB drift, so there is no reason to pick anything other than the midpoint. At today's
BNB $579.14 that is `graduationReserve = 43.17 BNB`, snapshotted into the pool at creation.

**Trigger basis:** `pool.ethReserve >= pool.graduationReserve` — real BNB actually accumulated in the
curve, compared against a threshold whose USD value was fixed by the oracle at creation. This
satisfies both halves of the spec's Section 6 rule at once:

- *"triggered by actual BNB reserve accumulated in the bonding curve"* — the compared quantity is
  `ethReserve`, real money in the contract.
- *"not by a market-cap display figure"* — it is **not** `price × totalSupply`, which is what
  Arrowpad uses today and what the spec is rejecting. A market cap is notional; a reserve is real.
- *"$20,000–$30,000 in real BNB reserve"* — the USD anchor is honoured via the creation-time oracle
  read, rather than drifting with a hardcoded BNB constant.

Worth being precise about the distinction, since it is the crux: **reserve × BNB price** is the
dollar value of money actually paid in. **Market cap** is a notional figure derived from the marginal
price and the full 1B supply — roughly 5× larger, and movable by a single small trade. The spec
rejects the latter; this design uses neither in the hot path, having captured the USD relationship
once at creation.

The reserve is measured *net of the 1% fee*: a token graduates after ~43.6 BNB of gross buy volume,
of which 43.17 reaches the curve.

**Chainlink sets this threshold** — read once, at creation, to derive `graduationReserve` and `V`
(§1). The oracle is what makes the $25,000 anchor real rather than a BNB constant that drifts.

What it does *not* do is price the reserve live on every trade. That distinction is not a preference;
it is the difference between working and bricking (see "the trap" in §1). Snapshotting also means:

- **Graduation is deterministic and independently verifiable.** Anyone can read `ethReserve` and
  `graduationReserve` from the chain and know exactly how far a token is from graduating. Under a
  live-priced trigger the same token crosses and un-crosses the line as BNB moves, with no trade
  occurring — progress bars would jitter and the "graduating soon" state would be unstable.
- **An oracle outage cannot stall or mis-fire a migration.** Graduation is the one path where a wrong
  price is unrecoverable: the pool opens, liquidity burns, and it cannot be undone.
- **A stale print cannot be exploited at the moment of migration**, which is the highest-value block
  in a token's life and therefore the one worth attacking.

The LP opening price is likewise derived from the curve's own final state (§10, Phase 2) rather than
a live USD target, for the same reason: it is one-way and unrecoverable.

---

## 3a. Chainlink oracle — scope and configuration

**Decision: Chainlink is used, on BSC.** (Confirmed 2026-07-14, overriding the earlier draft that
proposed removing it.) `AggregatorV3Interface` and Arrowpad's existing feed plumbing are retained.

**Verified feeds** (queried live on BSC mainnet, 2026-07-14 — not taken from memory):

| Network | BNB/USD feed | Verified |
|---|---|---|
| BSC mainnet | `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | `description()` = "BNB / USD", `decimals()` = 8, reporting **$581.52** |
| BSC testnet | `0x2514895c72f50D8bd4B4F9b1110F0D6bD2c97526` | `description()` = "BNB / USD" |

The three existing deploy scripts all point at **ETH/USD** feeds (`Deploy.s.sol` uses Ethereum
mainnet's `0x5f4e...8419`) and must be repointed — this is a silent, high-severity misconfiguration
if missed, because an ETH/USD feed on BSC would still return a plausible-looking number.

**Where the oracle is and is not used:**

| Use | Oracle? | Why |
|---|---|---|
| **Curve calibration + `$25,000` graduation threshold, at creation** (§1) | **yes — reverts if stale** | sets the USD anchor; wrong value here misprices one new token, which is contained |
| `$10` mandatory first-buy floor (§7) | **yes** — same read, same tx | the spec asks for *$10*, not a BNB constant |
| USD price / market cap in events, for the indexer and UI | **yes** — never reverts | display; a wrong value is cosmetic and self-corrects |
| **Graduation trigger** | **no** — snapshotted at creation | live pricing bricks tokens (§1, "the trap") |
| **LP sizing at migration** | **no** — derived from the curve | one-way and unrecoverable |

The split is the point: **the oracle is read once, at the cheapest possible moment to be wrong, and
never again.** At creation, a bad price mis-calibrates a single token that has no holders yet and no
liquidity — the blast radius is one launch. At migration, a bad price burns real liquidity into a
mispriced pool, permanently, for every holder. Same feed, same failure, two very different outcomes.

This is also why creation is the one function allowed to **revert** on a stale feed, while every
other consumer degrades. Refusing to launch a token for a few minutes is a minor inconvenience; a
permanently mis-calibrated curve is forever.

**Configuration for BSC:**

- **`priceStalenessThreshold = 300` (5 min), not 3600 and not 86400.** The 86400 value in the current
  code is an L2 workaround: on Arbitrum/Robinhood the feed's `updatedAt` is an L1 timestamp that lags
  the L2 clock by hours. **BSC is an L1 with a native feed, so that lag does not exist.** The live
  feed updated **19 seconds** before the block I queried, so 300s is ~15× headroom over observed
  behaviour while still catching a genuinely stuck feed. Confirm the published heartbeat on
  docs.chain.link during Phase 1 and set the threshold to roughly 10× it.
- **Keep `_rawEthPrice()`'s never-reverts contract.** It returns 0 on a stale, non-positive,
  incomplete-round, or reverting feed rather than throwing. This is the property that stops an oracle
  outage from freezing all trading, and it is already hardened and tested — do not "clean it up".
- Keep the `answeredInRound < roundId` and `updatedAt == 0` checks. They are cheap and they are what
  catch a half-dead feed reporting a stale round as fresh.

**Liveness:** every oracle consumer must degrade, never brick. Events emit `0` for USD figures during
an outage (the indexer backfills). The first-buy floor falls back to a stored BNB constant (§7).
Trading and graduation are oracle-independent by construction. Net effect: a total Chainlink outage
degrades the UI and leaves the protocol fully functional.

**Tests:** feed reverts / returns 0 / returns negative / returns a stale round / returns an
incomplete round → trading, creation, and graduation all still work. `MockPriceFeed.sol` already
exists for this. This is the highest-value test group in the plan, because it is the one where the
failure is silent.

---

## 4. Automatic vs manual graduation

**Recommend automatic**, with a multisig break-glass. This is both safer and standard practice
(pump.fun, four.meme, and every credible launchpad graduate automatically).

Manual confirmation is actively worse here, for three reasons:

1. **It creates a front-running position.** Migration is a known, scheduled price event. Whoever
   holds the confirm key can buy immediately before calling it. That is an insider-trading surface
   that does not need to exist — and it exists even if the team never uses it, because users cannot
   verify that it wasn't used.
2. **It is a liveness dependency.** If the multisig is asleep, a token that hit its target keeps
   trading on the curve above the graduation price. Every minute of delay is a growing gap between
   the curve price and where the pool will open.
3. **It transfers blame.** Automatic graduation is a property of the contract. Manual graduation is
   a decision Fyuz made, on a timestamp, for each token — and every delayed migration becomes a
   support ticket accusing you of favoritism.

The failure mode manual confirmation is meant to protect against — migration reverting and bricking
the token — is already handled. Arrowpad wraps migration in `try/catch`, so a failed migration cannot
revert the triggering buyer's trade, and funds stay safe in the curve.

**Keep one recovery lever:** a multisig-only `forceGraduate(token)` for the case where auto-migration
repeatedly fails (e.g. a griefer pre-seeded the Pancake pair at a hostile price). This is a
break-glass, not the normal path. Arrowpad's equivalent (`recoverPoolType`) already exists and has
test coverage.

**Who pays for migration:** whichever buyer's trade crosses the threshold pays the migration gas
(~$1–3 on BSC at current gas prices — to be measured precisely in Phase 4). On BSC this is
acceptable. It would not be on Ethereum mainnet.

**On the graduation fee — a flag.** The spec says it should be "sized to Fyuz's actual migration /
liquidity-pool-creation costs — not set as a revenue line." Fyuz's *actual on-chain* cost is
approximately **zero**, because the last buyer pays the migration gas, not Fyuz. A literal reading
means a fee of ~0.001 BNB. If the intent is to cover off-chain infrastructure (image pipeline,
indexer, RPC), that is a legitimate cost but it is not a migration cost, and the public framing
should say so. Recommend **0.05 BNB (~$29)** described honestly as "migration and platform
infrastructure", or **0.01 BNB (~$6)** if you want the number to survive a hostile reading. Either
way it is deducted from the reserve *before* LP sizing, and the LP token amount scales down
proportionally so the migration price gap stays at zero. **Decision needed — see §9.**

---

## 5. Multisig signer setup

**Recommend 3-of-5 Gnosis Safe** as protocol owner and treasury.

2-of-3 is the pragmatic floor and it is what most projects at this stage actually run, but it has a
sharp edge: it tolerates exactly one lost key *or* one compromised key, never both, and with three
signers there is usually social pressure such that two of them are the same two people in practice.
3-of-5 tolerates two losses and requires two independent compromises. The marginal cost is finding
two more signers — the operational overhead is near identical.

Hard requirements for the signers, which matter more than the threshold:

- Five **distinct hardware wallets, five distinct seed phrases**. Two signers on one Ledger is a
  1-of-N pretending to be an M-of-N — this is how most "multisig" rugs actually happen.
- **At least two signers outside the core dev team.** All-insider signers means the multisig is
  governance theatre; it protects against key loss but not against the team.
- No signer key in a browser extension hot wallet, ever.
- Signers geographically separated where practical.
- **Rehearse recovery before launch.** Deliberately exclude one signer and confirm the remaining four
  can still execute. An untested multisig is a single point of failure you have not found yet.

**Add a separate `guardian` address that can `pause()` but not `unpause()`.** Pausing is a fire
alarm — you want any one person able to pull it at 3am without assembling three signers. Unpausing is
a governance decision and stays 3-of-5. This is ~5 lines and it is the difference between a
five-minute incident and a five-hour one. The guardian can be a 2-of-3 ops Safe or even a hot EOA,
because the worst a compromised guardian can do is halt trading, which the real multisig then undoes.

**Cap the fees in code rather than timelocking fee changes.** The spec puts "change trading/referral
fee percentages" under multisig control, which invites the question: what stops a compromised
multisig from setting the fee to 90%? Arrowpad currently caps each fee at 10%. Tighten to a hard
immutable **`TOTAL_FEE_BPS ≤ 200` (2%)** that no address can raise. A cap is strictly better than a
timelock here: it needs no monitoring, no user vigilance, and no trust. Timelocks only help users who
are watching.

Keep Arrowpad's existing 24h timelocks on emergency withdrawal and liquidity-manager changes — those
are the paths that can actually move funds.

**Handover:** switch to `Ownable2Step` so ownership transfer to the Safe requires the Safe to accept,
making it impossible to fumble the handover to a wrong or dead address. The deploy script transfers
ownership as its final action; the deployer EOA retains nothing. This satisfies the spec's "developer
has no standing admin access after handover" — and it should be **verified from a block explorer
after deploy, not assumed from the script**.

---

## 6. Governance mapping

| Permission | Controlling address | Mechanism |
|---|---|---|
| Change trading/referral fee % | Fyuz multisig | `onlyOwner`, hard-capped at 2% total in code |
| Pause new launches / trading | Multisig **or guardian** | guardian may pause only |
| Unpause | Fyuz multisig | `onlyOwner` |
| Confirm/automate graduation | automatic; multisig break-glass | `forceGraduate` is `onlyOwner` |
| Withdraw/move treasury | Fyuz multisig | Safe; curve-backed BNB is unwithdrawable by construction |
| Retune `GRADUATION_USD` | Fyuz multisig | **applies to new tokens only** — see below |
| Mint additional supply | **no address** | `Token.sol` has no `mint()`; owner renounced at launch |
| Permanent unilateral control | **none** | `Ownable2Step` to Safe on deploy; deployer keeps nothing |

**`graduationReserve` and `virtualBnbReserve` are snapshotted per-token at creation, never read
live.** §1 establishes this is required for correctness (a live threshold bricks tokens); it is also
required for governance safety. If `GRADUATION_USD` were read live at trade time, the multisig could
move the finish line under a token already mid-curve — traders who bought at 90% progress would wake
up at 60%. Snapshotting means **a launched token's economics are immutable even to the multisig**,
which is a genuinely strong claim to be able to make publicly.

The multisig can retune `GRADUATION_USD` for *future* launches without ever touching a live curve.
One correctness requirement follows: the retune setter must validate against the same `ceilDiv`
invariant as creation, or a badly-chosen value silently bricks every subsequent launch.

Arrowpad's `totalCurveEthReserve` accounting already guarantees emergency withdrawal can only touch
stray/donated BNB, never BNB backing an active curve. Keep it; it is the strongest anti-rug property
in the codebase.

---

## 7. Fusion, moderation, and the creation flow

**Nothing about fusion belongs in the contract.** Exactly-two-source-figures, platform-only image
generation, and content moderation are all creation-flow concerns enforced by the backend. The
contract's only anti-spam mechanism is the mandatory first buy, per spec. "No uniqueness restriction
on figure pairs" means the contract has nothing to enforce.

**Recommend: `createToken` stays permissionless**, with an optional `bytes32 fusionId` emitted in
`TokenCreated` (emitted, not stored — costs ~375 gas, gives the indexer an immutable on-chain link
to the fusion record).

The alternative — gating `createToken` behind a backend EIP-712 signature — is worse. It makes token
creation dependent on backend liveness (backend down = nobody can launch), it puts a signing key on a
server, and it buys very little: someone who calls `createToken` directly with no fusion gets a token
the Fyuz UI never displays, because the backend only indexes fusions its own pipeline generated. An
unindexed token is invisible and therefore worthless. **Moderation holds at the UI layer, which is
where it can actually be reasoned about and reversed.** A moderation decision baked into a contract
is a moderation decision you cannot undo.

**Mandatory first buy — enforced in USD, from the same oracle read that calibrates the curve.**
Creation already reverts on a stale feed (§3a), so the floor needs no separate fallback path:

```solidity
uint256 public minFirstBuyUSD = 10e18;   // multisig-settable

// inside createToken(), reusing the `price` already read for calibration:
require(buyAmount * price / 1e18 >= minFirstBuyUSD, "First buy below $10 minimum");
```

One oracle read serves calibration, the graduation threshold, and this floor — they are all
consistent by construction because they see the same price in the same transaction.

Creation cost to the user: ~0.0173 BNB (~$10) + gas. No launch fee (`CREATE_TOKEN_FEE_AMOUNT = 0`).
The creator receives ~1.20M tokens for the buy — it is a purchase, not a fee.

**Frontend note:** quote the floor from a `view` and submit ~2% over it. BNB can tick between quote
and inclusion, and an exact-floor transaction would revert on an otherwise-valid creation. The excess
is refunded by the existing `createToken` refund path, so overshooting is free.

---

## 8. Ship V2 only

**Phase 1 supports PancakeSwap V2 exclusively.** Delete the V3 and V4 migration paths.

Arrowpad supports three (`poolType` 1/2/3) because it targets Uniswap. On BSC, PancakeSwap V2 is a
Uniswap V2 fork and works with the existing `INineInchRouter`/`INineInchFactory` interfaces
essentially as-is. Pancake V3 and Pancake Infinity are *not* drop-in — different factory, different
position manager, an extra `deployer` field in the pool key. Porting them means rewriting
`ArrowpadLiquidityManager` (1083 lines) against unfamiliar interfaces, for a Phase 1 that does not
need them.

V2-only also happens to be exactly right for the spec's "**liquidity is burned, not locked**"
requirement: burning V2 LP is sending a fungible ERC20 to `0xdEaD`, permanent and trivially
verifiable by anyone on BscScan. Burning a V3/V4 position means burning an NFT — messier, and much
harder for a user to independently confirm.

What this deletes: two migration paths, the V3/V4→V2 `try/catch` fallback chain, `recoverPoolType`'s
main use case, and roughly a third of the liquidity manager. That is a meaningful reduction in the
surface an auditor has to review — which is both cheaper and a better audit.

Add V3 in Phase 2 if concentrated liquidity turns out to matter. It probably will not.

---

## 9. Decisions needed before Phase 2

1. **Graduation fee: 0.01 BNB or 0.05 BNB?** (§4) Blocks the LP sizing tests. Actual on-chain cost is
   ~$0. Recommend 0.05 BNB, framed publicly as migration + infrastructure.
2. **Confirm 3-of-5 and identify the five signers**, specifically the ≥2 non-core-team ones. (§5)
   This has a long lead time — start now, it is people, not code.
3. **Confirm permissionless `createToken`** with UI-layer moderation. (§7)
4. **Audit firm and slot.** Booking lead time is typically 3–6 weeks and it gates mainnet. Book
   before code freeze, not after.
5. **Treasury Safe deployed on BSC**, address confirmed, recovery rehearsed. Gates deploy.

---

## 10. Build phases

Phases 1–4 are sequenced by dependency. Where work is independent it is marked parallel.

### Phase 1 — Fork and strip
Copy `Arrowpad.sol` → `FyuzPad.sol`, `ArrowpadLiquidityManager.sol` → `FyuzLiquidityManager.sol`.
Port the test suite alongside; it must stay green at every step.

- **Keep** the Chainlink feed, `_rawEthPrice`, `priceStalenessThreshold`, `getTokenVirtualMarketCap`,
  and `ethPriceUSD` in events (§3a). Repoint all deploy scripts from ETH/USD to the verified BSC
  BNB/USD feeds. Set `priceStalenessThreshold = 300`.
- Delete `getFirstBuyFee` / `firstBuyFeeUSD` (Fyuz has no launch fee — replaced by the §7 floor) and
  `getETHPriceByUSD` (the reverting variant; its only caller was oracle-gated LP sizing, which is
  going away in Phase 2). `_rawEthPrice`'s never-reverts variant is the one that survives.
- Delete the V3/V4 migration paths and their liquidity-manager code. Delete `poolType` entirely.
- Delete `EthismFeeDistributor` wiring and the 50/50 `_payPlatformFee` split (Arrowpad-specific).
- Rename ETH → BNB throughout for readability.

*Exit: suite green minus the deleted-feature tests. Expect ~500 lines net removed.*

### Phase 2 — Curve and graduation
- Set `GRADUATION_USD = 25_000e18`, `T`, `R` per §1. Add `graduationReserve` to `PoolInfo`.
- In `createToken`: read the oracle once (revert if stale), derive `G = GRADUATION_USD/price` and
  `V = ceilDiv(G·(T−R), R)`, snapshot both into the pool (§1).
- `_checkAndAddLiquidity`: trigger on `pool.ethReserve >= pool.graduationReserve`. Delete
  `getTokenVirtualMarketCap`-gated graduation and `TARGET_MARKET_CAP_USD`.
- Replace `_tokensForTargetMcap`'s USD math with the deterministic curve-derived amount:
  `tokensForLP = lpBnb · (T − tokensSold) / (V + finalReserve)`. Burn the remainder.
- **Invariant test: `graduationReserve ≤ V·R/(T−R)` at creation**, fuzzed over BNB $50–$5,000 — the
  §1 unreachability trap. Assert it fails with floor division, to prove the test has teeth.
- **Test: a token created at BNB $300 and one at $1,000 have identical USD economics** (start FDV,
  graduation FDV, and the −0.007% LP gap) — the §1 calibration table, as executable assertions.
- **Test: migration price gap < 0.01%** across careful, overshoot, and dust-buy graduations. Port
  `test_18`/`test_19`, which already cover this shape.
- Add `forceGraduate(token)`, `onlyOwner`.

- **Test: graduation fires identically with the oracle stale, dead, or reverting** — proves the
  trigger and LP sizing are genuinely oracle-independent (§3a).

*Exit: a token created at today's BNB graduates at ~$25,000 of real reserve and opens the Pancake
pool within 0.01% of the curve price — and still graduates with the oracle dead, because the
threshold was fixed at creation.*

### Phase 3 — Fees, referral, creation (parallel with Phase 2 after constants land)
- Restructure to a single `TOTAL_FEE_BPS = 100`, split 20 creator / 10 referral / 70 treasury,
  falling back to 0 / 80 when unattributed. Hard immutable cap at 200 bps.
- `referrerOf` mapping, sticky on first trade. `address referrer` param on buy/sell.
- `CREATE_TOKEN_FEE_AMOUNT = 0`; enforce the $10 floor from the calibration oracle read (§7).
- `bytes32 fusionId` param, emitted in `TokenCreated`, not stored.
- Tests: split sums to exactly 1% in both branches; referrer sticks and cannot be overwritten;
  self-referral routes to treasury; creation reverts below the $10 floor; fee cap is unraisable;
  **creation reverts (does not silently mis-calibrate) when the oracle is stale**.

### Phase 4 — Governance and deploy
- `Ownable2Step`; `guardian` role with pause-only rights.
- Deploy script: deploy → wire → transfer ownership to the Safe → assert deployer holds nothing.
- Measure actual migration gas cost; confirm the graduation fee against it (§9.1).
- BSC testnet deploy. Graduate a real token end-to-end against real PancakeSwap V2. Verify from
  BscScan that LP is at `0xdEaD` and the deployer has no role.

### Phase 5 — Audit and mainnet
- Code freeze → external audit → remediate → re-test → mainnet.
- Post-deploy verification **from a block explorer, independent of the deploy script**: owner is the
  Safe, deployer has no role, no `mint()` exists on `Token`, fee cap is what you think it is.
- Backend/frontend integration (fusion pipeline, moderation, indexer, `?ref=` links) runs parallel
  from Phase 3 — it only needs the ABI, not the audit.

### Effort

| Phase | Estimate | Notes |
|---|---|---|
| 1 — Fork and strip | 2–3 days | mostly deletion |
| 2 — Curve and graduation | 3–4 days | the real work is the invariant tests |
| 3 — Fees, referral, creation | 2–3 days | parallel with 2 |
| 4 — Governance and deploy | 2–3 days | + testnet soak |
| 5 — Audit | 2–4 weeks | external, **book early** |

**~2 weeks to testnet-complete, then audit-gated.** This is only credible because Arrowpad exists and
its 82 tests pass today; from scratch it is a 2–3 month build.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| **Live-USD trigger → threshold exceeds curve max → every token bricks** | **this is the §1 trap, and the naive design fails at today's BNB price.** V derived from G at creation with `ceilDiv`; fuzzed invariant test |
| `ceilDiv` regressed to floor division in review ("simplification") → last buyer of every token stranded | invariant test asserts the floor-division variant fails; comment the `ceilDiv` with its reason |
| BNB moves >±20% between a token's creation and graduation → outside $20k–$30k | accepted residual; tokens graduate in hours–days (§1) |
| Multisig retunes `GRADUATION_USD` to a value that bricks new launches | setter validates the same invariant as creation (§6) |
| Griefer pre-seeds the Pancake pair at a hostile price | Arrowpad's V2 path already seeds the pair directly and absorbs donated WETH; `test_26` covers it |
| Creator refuses the 0.2% fee to brick trading | `_transferETHTolerant` already reroutes to treasury; keep |
| Fee-raise rug | immutable 2% cap in code (§5) |
| **Deploy script left pointing at an ETH/USD feed on BSC** | all three current scripts do; repoint in Phase 1, assert `description() == "BNB / USD"` in the deploy script itself (§3a) |
| Chainlink outage or stale feed | oracle is out of the graduation and LP paths entirely; `_rawEthPrice` returns 0 rather than reverting; first-buy floor falls back to BNB (§3a, §7) |
| Staleness threshold copied from the L2 config (86400) | BSC is an L1 with a native feed; set 300s and test it (§3a) |
| Manual-graduation front-running | not building manual graduation (§4) |
| Multisig is theatre (shared keys / all-insider) | distinct hardware + seeds, ≥2 non-core signers, recovery rehearsed (§5) |
| Audit findings force a redesign | freeze scope at Phase 4; V2-only keeps the surface small |

---

## Appendix — reproducing the curve

Calibration script: `foundry/script/curve.py` (to be committed in Phase 2). Regenerates the §1 table
from `T`, `R`, `G`. Pass a BNB price to re-derive the USD columns:

```
G     = GRADUATION_USD / bnbPrice          # graduation reserve, from the oracle AT CREATION
V     = ceil( G · (T − R) / R )            # virtual BNB reserve — ceil, or Emax lands under G
E(s)  = V · s / (T − s)                    # real BNB reserve after s tokens sold
p(s)  = (V + E(s)) / (T − s)               # BNB per token
Emax  = V · R / (T − R)                    # max reachable reserve — MUST be >= G, else the token bricks
```

Two invariants the script checks, and Phase 2 asserts on-chain:

```
Emax >= G                                  # reachability — the §1 trap
2RT − R² ≈ T · TOTAL_SUPPLY                # zero LP price gap; holds for any V (0.0014% error)
```
