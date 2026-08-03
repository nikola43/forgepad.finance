/**
 * Every response type the Fyuz API returns, as named interfaces.
 *
 * @module
 */

export type { ApiErrorBody, ChainConfig, ChainInfo, CreatorInfo, HealthStatus } from './common.js';
export type {
  DiscoverToken,
  Holder,
  KingResponse,
  Token,
  TokenDetail,
  TokenPage,
} from './token.js';
export type { Candle, RecentTrades, Trade, TradeSide } from './trade.js';
export type { TokenAnalytics, TopTrader } from './analytics.js';
export type { Portfolio, PortfolioPosition, WalletStats } from './wallet.js';
export type {
  AchievementState,
  ChatMessage,
  QuestState,
  Rewards,
  TierInfo,
  TierName,
  TopHolderEntry,
  UserProfile,
  UserSummary,
} from './user.js';
export type {
  KingReign,
  LeaderboardEntry,
  ReferralLeaderEntry,
  Season,
  SeasonEntry,
} from './leaderboard.js';
export type {
  AddressPayouts,
  Claimable,
  PayoutLine,
  PayoutStats,
  Pot,
  RoundDetail,
  RoundReceipt,
  ShareEntry,
  Shares,
} from './distributor.js';
