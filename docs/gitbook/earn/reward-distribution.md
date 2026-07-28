# 🎰 Reward Distribution

This is where points become BNB. Every round, the rewards pot pays out on-chain — automatically, verifiably, and with a lottery twist.

## Where the pot comes from

**0.3% of every single trade** on Fyuz flows into the Distributor smart contract. The pot grows with every buy and sell on the platform, all round long.

## How a round pays out

When a round closes (default: weekly), the Distributor contract splits the pot:

| Slice | Who gets it | How |
| --- | --- | --- |
| **90%** | The **top 100** on the leaderboard | Pro-rata by points — twice the points, twice the BNB |
| **10%** | **One random participant** | Picked by Chainlink VRF — provably fair on-chain randomness |

### The 10% jackpot 🎲

Here's the fun part: the lottery is **uniform**. Every one of the top 100 holds exactly **one ticket**, whether they farmed 50,000 points or scraped in with 50. Rank #100 has the same shot at the jackpot as rank #1.

That's by design — the pro-rata 90% rewards grinding, the 10% rewards *showing up*.

## Why you can trust it

* **The pot is on-chain.** The 0.3% fee lands in the contract with every trade — check the balance yourself.
* **The winner is on-chain random.** Chainlink VRF generates the random number with a cryptographic proof that nobody — not even the Fyuz team — can predict or manipulate.
* **The payout is public.** Every round emits events: pot size, every recipient, every amount, the winner. Anyone can audit any round, forever.
* **The shares are auditable.** The leaderboard snapshot used for each round is posted on-chain before payout and can be compared against the public API.

## After the round: reset

The moment a round pays out, **the leaderboard clears**. Everyone starts the next round at zero points. New week, new race, new jackpot.

{% hint style="success" %}
You don't need to claim anything. Payouts are pushed straight to your wallet in BNB the moment the round distributes.
{% endhint %}
