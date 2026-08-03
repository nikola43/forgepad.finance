/**
 * Leaderboard, king-of-the-hill and season wire types.
 *
 * `rank` is a server-assigned 1-based ordinal that matches the order rows are
 * returned in. Do not re-sort client-side — the ordering key is not always the
 * field you are displaying.
 *
 * @module
 */

/**
 * One row of the global points leaderboard.
 *
 * The board resets after every Distributor payout: only activity since the last
 * settled round counts.
 */
export interface LeaderboardEntry {
  /** 1-based, in returned order. */
  rank: number;
  address: string;
  username: string | null;
  avatar: string | null;
  /** USD volume in the current round window. */
  volumeUsd: number;
  /** Trade count in the current round window. */
  trades: number;
  /** Points that count toward the payout share — the exact number served to the Distributor. */
  points: number;
  /** Total points earned including locked grants. Always `>= points`. Display only. */
  pointsTotal: number;
  /** Points at round close if the current position is held. Guidance, not a payout. */
  pointsProjected: number;
  /** USD value currently held. */
  heldUsd: number;
  /**
   * Estimated BNB slice of the live pot: `90% x pot x (points / payout-set points)`.
   * `0` when below the payout floor.
   */
  rewardEth: number;
}

/**
 * One row of the referral leaderboard.
 *
 * Only ACTIVE referrals (the referee cleared the net-buy floor) are counted.
 */
export interface ReferralLeaderEntry {
  /** 1-based, in returned order. */
  rank: number;
  address: string;
  username: string | null;
  avatar: string | null;
  /** Active referrals only. */
  referralCount: number;
  /** USD volume traded by this referrer's referees. */
  refereeVolumeUsd: number;
}

/** One King-of-the-Hill reign. */
export interface KingReign {
  tokenAddress: string;
  name: string;
  symbol: string;
  image: string | null;
  network: string;
  /** Reign start, UNIX **seconds**. */
  startedAt: number;
  /** Reign end, UNIX **seconds**. `null` while the reign is ongoing. */
  endedAt: number | null;
  /** Reign length in seconds. Ongoing reigns count up to now. */
  durationSecs: number;
}

/** One row of the season standings. */
export interface SeasonEntry {
  /** 1-based, in returned order. */
  rank: number;
  address: string;
  username: string | null;
  avatar: string | null;
  points: number;
}

/** Response of `GET /season`: the current season window, prize pot and standings. */
export interface Season {
  /** e.g. `"Season 1"`. */
  name: string;
  /** Season start, UNIX **seconds**. */
  startsAt: number;
  /** Season end, UNIX **seconds**. */
  endsAt: number;
  /** Prize pot in BNB. */
  prizePotEth: number;
  /** Top 50 with positive points, highest first. */
  leaderboard: SeasonEntry[];
}
