# 📈 The Bonding Curve

Every Fyuz token (except direct launches) starts life on a bonding curve — an automated market that needs no liquidity providers and can't be rug-pulled.

## How it works

* Each token launches with a fixed **1,000,000,000 supply** held by the curve.
* The price is a mathematical function of how much has been bought: the earlier you buy, the cheaper the token. Every buy pushes the price up; every sell pushes it back down the same path.
* BNB paid in is held by the curve contract itself. There is no liquidity to pull — the curve **is** the liquidity.

## Graduation 🎓

When a token's market cap reaches **$30,000** (measured in USD via a Chainlink price feed, at roughly 83% of the curve), it **graduates**:

1. Trading on the curve stops.
2. The curve's BNB and remaining tokens are seeded into a **PancakeSwap pool** (the version the creator chose at launch).
3. From then on it's a normal DEX token — trade it anywhere.

Graduation is the win condition. Graduated tokens get the 🎓 badge, their creator earns +50 bonus points, and anyone who held through graduation unlocks the **Graduate** achievement (+15 points).

## Why a curve?

| Problem with classic launches | The curve's answer |
| --- | --- |
| Team pre-mints and dumps | Nobody holds supply at launch — not even the creator (unless they buy like everyone else) |
| Liquidity gets pulled | The curve contract holds the BNB; graduation locks it into a DEX pool |
| Snipers front-run the listing | Creators can bundle the first buy into the creation transaction |
| Fake price via thin LP | Price is deterministic from the curve formula — no spoofing |

## King of the Hill 👑

The token closest to graduation wears the crown on the front page. Dethrone the king by pushing your fusion's market cap past theirs.
