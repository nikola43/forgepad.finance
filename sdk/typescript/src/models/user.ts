/**
 * User profile, tier and rewards wire types.
 *
 * @module
 */

import type { Holder, Token } from './token.js';

/** Public profile record. */
export interface UserSummary {
  id: number;
  address: string;
  username: string | null;
  avatar: string | null;
  bio: string | null;
  /** Profile likes received. */
  likes: number;
  /** `true` for Fyuz staff accounts. `null` when unset. */
  isAdmin: boolean | null;
  /** X/Twitter handle, without the leading `@`. */
  twitterUsername: string | null;
}

/** A comment posted by a user on a token page. */
export interface ChatMessage {
  id: number;
  tokenAddress: string;
  /** Always `null` on the profile endpoint — replies are not expanded there. */
  replyAddress: string | null;
  comment: string;
  /** Optional attachment/image code. */
  code: string | null;
  /** RFC-3339 timestamp (not UNIX seconds, unlike most other timestamps in this API). */
  date: string;
  network: string;
}

/**
 * Response of `GET /users/profile/{address}`: identity, current holdings,
 * comments, launched tokens and current-round points.
 */
export interface UserProfile {
  /** Identity record. */
  user: UserSummary;
  /** Current holdings, positive balances only. */
  holdings: Holder[];
  /** Comments by this user, newest first, max 50. */
  chats: ChatMessage[];
  /** Tokens launched by this address, newest first. */
  createdTokens: Token[];
  followers: number;
  followees: number;
  /** Active referrals only. */
  referralCount: number;
  /** Referral earnings ledger balance (an integer point count, not the trading score). */
  points: number;
  /** Points in the current round window; matches the leaderboard's `points`. */
  tradingPoints: number;
  /** USD volume in the current round window. */
  tradingVolumeUsd: number;
  /** Estimated BNB slice of the live pot. */
  rewardEth: number;
}

/** One row of `GET /users/top/{count}`: a wallet ranked by USD volume over the window. */
export interface TopHolderEntry {
  address: string;
  username: string | null;
  avatar: string | null;
  /** USD trading volume over the requested window. */
  volume: number;
}

/** Display-only trader tier, derived from lifetime USD trade volume. */
export type TierName = 'Bronze' | 'Silver' | 'Gold' | 'Diamond';

/**
 * Response of `GET /tier/{address}`.
 *
 * Thresholds: Bronze $0, Silver $100, Gold $1,000, Diamond $10,000.
 */
export interface TierInfo {
  /** Lower-cased address. */
  address: string;
  /** Lifetime USD trade volume. */
  volumeUsd: number;
  tier: TierName;
  /** The next tier up, or `null` at Diamond. */
  nextTier: string | null;
  /** USD volume needed for {@link TierInfo.nextTier}, or `null` at Diamond. */
  nextThresholdUsd: number | null;
  /** Progress toward the next tier, 0-100. `100` at Diamond. */
  progressPct: number;
}

/** A quest and one address's progress against it. */
export interface QuestState {
  /** Stable identifier, e.g. `"daily_trade"`. */
  key: string;
  title: string;
  description: string;
  /** Quest cadence, e.g. `"daily"` or `"oneoff"`. */
  kind: string;
  /** Value that completes the quest. */
  target: number;
  /** Current progress, clamped to {@link QuestState.target}. */
  progress: number;
  /** Points awarded on completion. */
  points: number;
  completed: boolean;
  /** Granted automatically by the indexer — there is no claim call on this public surface. */
  claimed: boolean;
}

/** A lifetime achievement and whether an address has earned it. */
export interface AchievementState {
  key: string;
  title: string;
  description: string;
  /** Icon identifier (emoji or asset key). */
  icon: string;
  points: number;
  earned: boolean;
}

/**
 * Response of `GET /rewards/{address}`: streaks, points and quest/achievement state.
 *
 * Read-only. Rewards are granted automatically by the indexer as they are earned;
 * there is no claim step.
 */
export interface Rewards {
  address: string;
  /** Consecutive active days. */
  currentStreak: number;
  longestStreak: number;
  /** The headline figure — identical to the leaderboard's `points`. */
  points: number;
  /** Grant subtotal only; not the number to lead with. */
  bonusPoints: number;
  quests: QuestState[];
  achievements: AchievementState[];
}
