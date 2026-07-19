# 📜 Smart Contracts

Fyuz's on-chain core, written in Solidity and tested with Foundry.

## Fyuz (the launchpad)

The main contract: an upgradeable proxy that owns every bonding curve.

* **Token factory** — deploys each fusion token with 1B fixed supply
* **Bonding curve engine** — deterministic pricing; buys and sells settle in the same transaction
* **Graduation** — at **$30,000 market cap** (Chainlink BNB/USD feed, staleness-checked), the curve closes and liquidity is seeded into the creator's chosen PancakeSwap pool via a liquidity manager behind a **timelock** (graduation funds can't be redirected instantly, even by the owner)
* **Fee splitter** — the 1% trade fee splits in-transaction: 0.6% treasury / 0.2% Distributor / 0.2% creator

## Distributor (the rewards engine)

Receives the 0.2% fee stream and pays it back out in rounds:

| Function | What it does |
| --- | --- |
| `startRound(from, to)` | Snapshots the pot, requests Chainlink VRF randomness |
| `postShares(id, packed)` | Commits the top-100 leaderboard shares on-chain (packed 24-byte entries: address + uint32 share of 2³²) |
| `distribute(id)` | Pays 90% pro-rata + 10% to the VRF-picked winner — callable by **anyone** once shares and randomness are in |
| `cancelRound()` | Voids a stuck round; the pot rolls into the next one |

Security properties:

* **VRF v2.5 with native BNB payment** — the winner draw is verifiable on-chain randomness; no LINK token management
* **Pot snapshot** at round start — mid-round fees are never double-counted
* **Failed transfers are skipped**, never block the round, and stay in the pot
* **Share sum can never exceed 100%** — shares are fractions of 2³², floored
* Pausable, with owner emergency withdrawal only while paused
* 15 Foundry tests cover the payout math, lottery, access control, and failure paths

## Chainlink integrations

| Service | Used for |
| --- | --- |
| **Price Feeds** (BNB/USD) | Measuring the $30K graduation target |
| **VRF v2.5** | The 10% lottery winner — provably fair randomness |

## Addresses

| Contract | BSC Testnet |
| --- | --- |
| Fyuz (proxy) | `0x24FEBdCc41C804873dbBfE703cD9D2D4b771C236` |
| Distributor | *deploying — will be updated* |

{% hint style="info" %}
Mainnet addresses will be published here at launch. Always verify addresses against this page — never trust addresses from DMs.
{% endhint %}
