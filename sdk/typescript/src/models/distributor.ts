/**
 * Distributor wire types — the on-chain leaderboard fee distribution.
 *
 * ## Wei fields are strings, always
 *
 * Every field whose name ends in `Wei` is an **exact uint256 decimal string**
 * (`"1250000000000000000"`, never `1.25e18`). `totalPaidWei` and `amountWei`
 * exceed the range a JavaScript `number` represents exactly, so parsing them into
 * a float silently corrupts them. Use `BigInt(value)` for arithmetic. `vrfRandom`
 * is likewise a decimal string, not hex and not a number.
 *
 * ## `null` never means zero
 *
 * A `null` wei field means the on-chain settlement has not been indexed yet, or
 * the RPC was unreachable. It means *unknown*. Rendering it as `0` tells the user
 * something false — hide the figure instead.
 *
 * @module
 */

/** Response of `GET /distributor/stats`: lifetime Distributor payback totals. */
export interface PayoutStats {
  /**
   * Everything ever paid out (pro-rata plus lottery), in wei as a decimal string.
   * `"0"` when nothing has settled.
   */
  totalPaidWei: string;
  roundsSettled: number;
  uniqueRecipients: number;
  /** Largest single payout in wei, decimal string. `"0"` when nothing has settled. */
  largestPayoutWei: string;
  /** Last settlement, UNIX **seconds**. `null` when nothing has settled. */
  lastRoundAt: number | null;
}

/** Response of `GET /distributor/pot`: the live undistributed pot and round parameters. */
export interface Pot {
  /**
   * Live BNB balance of the Distributor.
   *
   * `null` when no Distributor is configured or the RPC is unreachable — hide the
   * figure, do **not** render `0`.
   */
  potBnb: number | null;
  /** Basis points paid pro-rata by points; the remainder goes to the VRF winner. e.g. `9000`. */
  distributeBps: number;
  /** Next round close, UNIX **seconds**, read from the contract's own schedule. */
  roundEnd: number;
  /**
   * Points across the whole payout set — the denominator of every share.
   * `null` when it could not be computed.
   */
  totalPoints: number | null;
  /** Points credited per $1 of volume. Buys and sells score alike. */
  pointsPerUsd: number;
}

/** One holder's committed share of the next round. */
export interface ShareEntry {
  address: string;
  points: number;
  /** The holder's fraction of 2^32 — the on-chain share unit. Range 0…4294967295. */
  share: number;
}

/** Response of `GET /distributor/shares`: the allocation the round-runner posts on-chain. */
export interface Shares {
  /** Window start, UNIX **seconds**. */
  from: number;
  /** Window end, UNIX **seconds**. */
  to: number;
  totalPoints: number;
  /** Highest points first, capped at 100 (the contract's `MAX_HOLDERS`). */
  holders: ShareEntry[];
  /**
   * Calldata for `Distributor.postShares`: 24-byte entries of a 20-byte address
   * followed by the big-endian uint32 share, 0x-prefixed hex.
   */
  packed: string;
}

/**
 * A settled distribution round.
 *
 * Null wei fields mean the on-chain settlement has not been indexed yet — not zero.
 */
export interface RoundReceipt {
  roundId: number;
  /** Window start, UNIX **seconds**. */
  timeStart: number;
  /** Window end, UNIX **seconds**; becomes the start of the next leaderboard window. */
  timeEnd: number;
  txHash: string | null;
  /** Whole amount that left the contract (pro-rata plus lottery), wei decimal string. */
  potWei: string | null;
  /** Pro-rata portion only, wei decimal string. */
  distributedWei: string | null;
  /** VRF-picked lottery winner. */
  winnerAddress: string | null;
  /** Lottery amount, wei decimal string. */
  winnerAmountWei: string | null;
  holderCount: number | null;
  /**
   * The VRF word that selected the winner, as a **decimal string** (it is a
   * uint256 — not hex, not a number). Published so the draw can be checked
   * against the coordinator's own fulfilment.
   */
  vrfRandom: string | null;
  /** Settlement time, UNIX **seconds**. */
  distributedAt: number | null;
}

/** One recipient's line in a round. */
export interface PayoutLine {
  roundId: number;
  address: string;
  /** The recipient's fraction of 2^32, exactly as committed on-chain. */
  share: number;
  /** Exact wei, decimal string. */
  amountWei: string;
  username: string | null;
  avatar: string | null;
}

/**
 * Response of `GET /distributor/rounds/{id}`: a round receipt with its recipient list.
 *
 * The receipt fields are **flattened** — `roundId`, `potWei` and friends sit at the
 * top level next to `payouts`, not nested under a `round` key.
 */
export interface RoundDetail extends RoundReceipt {
  /** Recipients, richest first. */
  payouts: PayoutLine[];
}

/** Response of `GET /distributor/payouts/{address}`: every payout one wallet has received. */
export interface AddressPayouts {
  /** Lower-cased address. */
  address: string;
  /** Lifetime wei received across every settled round, summed exactly. Decimal string. */
  totalWei: string;
  roundsPaid: number;
  /** Individual lines, newest round first. */
  payouts: PayoutLine[];
}

/**
 * Response of `GET /distributor/claimable/{address}`.
 *
 * Wei owed to an address from payout pushes the contract could not complete
 * (contract wallets, reverting receivers). Withdrawn by calling `claim()` on the
 * Distributor — the wallet signs, this API only reads.
 */
export interface Claimable {
  /** Lower-cased address. */
  address: string;
  /**
   * Exact wei, decimal string. `null` when the RPC is unreachable or no
   * Distributor is configured — hide the banner rather than telling the user
   * nothing is owed.
   */
  claimableWei: string | null;
  /** Where to send the `claim()`. `null` when unconfigured. */
  distributorAddress: string | null;
}
