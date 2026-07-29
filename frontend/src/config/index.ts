export const isDevEnv = process.env.NODE_ENV === "development" || process.env.NEXT_PUBLIC_LOCAL_MODE === "true"

// Get projectId from https://cloud.reown.com
export const projectId = process.env.NEXT_PUBLIC_PROJECT_ID || "b419d851ce6dd9d448bcb52ac83ec1f1"

if (!projectId) {
  throw new Error('Project ID is not defined')
}

export const API_ENDPOINT = process.env.NEXT_PUBLIC_API_URL || `http://localhost:5001`
export const FILE_ENDPOINT = process.env.NEXT_PUBLIC_FILE_URL || `${API_ENDPOINT}/uploads`

export const FYUZ_TWITTER_URL = "https://x.com/FyuzLaunch"
export const FYUZ_WEBSITE_URL = "https://fyuz.fun"

// ---------------------------------------------------------------------------
// Fees & commercials
//
// Every fee the product quotes lives here, in the same basis points the
// contract stores them in. These are the FALLBACK values: the real numbers are
// on-chain and owner-tunable, so /fees reads them live from the Fyuz contract
// and only falls back to this block when the RPC is unreachable.
//
// If a fee is changed on-chain (a Safe transaction), change it here too — the
// banner and the fee page quote these until the live read lands.
// ---------------------------------------------------------------------------
export const FEES = {
  // Per-trade, charged on both buys and sells while a token is on the curve.
  // platformBps is split by platformTreasuryShareBps (6250) into treasury and
  // season-pot streams; the creator's cut is a separate on-chain fee.
  platformBps: 80,      // 0.8% — 0.5% treasury + 0.3% season pot
  treasuryBps: 50,      // 0.5% — operations, listings, marketing
  seasonPotBps: 30,     // 0.3% — the weekly leaderboard prize pot
  creatorBps: 20,       // 0.2% — paid to the token's creator, per trade, instantly

  createFeeBnb: 0.001,      // CREATE_TOKEN_FEE_AMOUNT
  minInitialBuyUsd: 10,     // minCreateBuyUSD — buys your own supply, not a fee
  graduationFeeBnb: 0.1,    // platformLPFee, taken once at graduation
  graduationMcapUsd: 30_000,// TARGET_MARKET_CAP_USD
  creatorLpSharePercent: 50,// creator's half of collectable DEX LP fees (V3 pools)
}

// The go-live promotion: the creator's per-trade cut is doubled on-chain via
// setTokenOwnerFeeBps. `active` drives the site-wide banner and the promo
// treatment on /fees — it does NOT change what the contract charges, so flip it
// in step with the on-chain change, never ahead of it.
export const CREATOR_FEE_PROMO = {
  active: true,
  multiplier: 2,
  bps: 40,                        // 0.4% — what setTokenOwnerFeeBps must be set to
  endsAt: null as string | null,  // ISO date ends the promo automatically; null = open-ended
  // When true the banner also waits for TOKEN_OWNER_FEE_BPS on-chain to reach
  // `bps` before showing. Currently false: the banner runs on the `active` flag
  // above. The fee table on /fees always quotes the live on-chain rate either
  // way, so the promo card there still waits for the contract.
  requireOnChainRate: false,
  // Copy — safe to rewrite without touching anything else.
  eyebrow: "Launch promo",
  headline: "2X creator fees",
  body: "Launch a token now and earn 0.4% of every trade on it — double the standard 0.2%, paid to your wallet instantly.",
  cta: "See all fees",
  href: "/fees",
}

/** Whether the promo should be presented as live right now. */
export function isCreatorFeePromoLive() {
  if (!CREATOR_FEE_PROMO.active) return false
  if (!CREATOR_FEE_PROMO.endsAt) return true
  return Date.now() < Date.parse(CREATOR_FEE_PROMO.endsAt)
}

/**
 * Whether to present the promo to users, given the creator fee the contract is
 * currently charging (undefined = not read yet / read failed). Every surface
 * that advertises the promo goes through this, so the site cannot claim a rate
 * creators are not being paid.
 */
export function showCreatorFeePromo(liveCreatorBps?: number) {
  if (!isCreatorFeePromoLive()) return false
  if (!CREATOR_FEE_PROMO.requireOnChainRate) return true
  return liveCreatorBps !== undefined && liveCreatorBps >= CREATOR_FEE_PROMO.bps
}

/** The creator's per-trade cut in bps, promo included. */
export function creatorFeeBps() {
  return isCreatorFeePromoLive() ? CREATOR_FEE_PROMO.bps : FEES.creatorBps
}

/**
 * Total bps taken out of a curve trade — the contract's
 * PLATFORM_BUY_FEE_BPS + TOKEN_OWNER_FEE_BPS. Quote estimates must use this or
 * they drift from what the swap actually returns.
 */
export function totalTradeFeeBps() {
  return FEES.platformBps + creatorFeeBps()
}

// Curated fusion universes/styles — mirrors backend-rs image_gen::STYLES labels.
// Used by the create form (chips) and the home style filter.
export const STYLE_PRESETS = [
  "Dragon Ball Z / anime action",
  "Cyberpunk neon",
  "Medieval fantasy",
  "Studio Ghibli-style",
  "Pixel art / 8-bit",
  "Film noir comic",
  "Classic superhero comic",
  "Renaissance oil painting",
  "Claymation / stop-motion",
  "Retro 80s synthwave",
  "Steampunk",
  "Wild West",
  "Ancient mythology (Greek/Norse)",
  "Space opera / sci-fi epic",
  "Watercolor illustration",
  "Graffiti / street art",
  "Samurai / feudal Japan",
  "Post-apocalyptic wasteland",
  "Pop art (Warhol-style)",
  "Gothic horror",
  "Egyptian mythology",
  "Cartoon Network style",
  "Vaporwave",
  "Baroque royal portrait",
  "Manga black-and-white",
]

