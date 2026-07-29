// Canonical leaderboard scoring. THE single definition of "points".
//
// Every surface that scores users — the payout shares served to the Distributor
// contract, the leaderboard, the season table, the airdrop allocation — builds
// its query from here. They previously each carried their own copy of the
// formula and had drifted apart, so what a user was shown was not what the
// contract paid on.
//
// ---------------------------------------------------------------------------
// WHY VOLUME
//
//     points = USD volume traded in the window, buys AND sells alike
//
// Every trade is scored the moment it lands and it is never taken away. Holding
// is not required, exiting does not burn what you earned, and a round-trip earns
// on both legs — the same way an AMM pays its liquidity providers on every swap
// in either direction, which is the model this deliberately mirrors.
//
// The predecessor scored a time-weighted average of the position still held:
//
//     points = (1/T) * ∫ max(0, net_position(t)) dt
//
// That priced TIME, which cannot be bought back, and so it was robust against
// snapshot-timing. But it also priced exactly the thing this product does not
// want to tax: selling. A trader who bought on Monday and took profit on Tuesday
// scored a fraction of a trader who bought the same size and sat on it, despite
// paying MORE in fees (a sell is charged the same 1% as a buy). It rewarded
// inactivity on a platform whose pot is funded by activity.
//
// ---------------------------------------------------------------------------
// WHY VOLUME IS NOT A WASH-TRADING FAUCET
//
// The obvious objection to scoring volume is that volume is self-manufacturable:
// buy, sell, repeat, farm the board. It is not profitable here, and the reason is
// structural rather than a heuristic that has to be tuned or policed.
//
// The pot is funded from the SAME volume it rewards. On BSC (Fyuz.sol):
//
//     PLATFORM_BUY_FEE_BPS / PLATFORM_SELL_FEE_BPS = 80    (0.80%)
//     TOKEN_OWNER_FEE_BPS                          = 20    (0.20%)
//     platformTreasuryShareBps                     = 6250  → 62.5% treasury,
//                                                    leaving 0.30% of volume
//                                                    to the Distributor pot
//
// charged on BOTH sides of every trade. So $1 of self-dealt volume costs the
// farmer $0.0100 and adds $0.0030 to the pot. Even if that farmer were 100% of
// all platform volume — the best case for them, since shares are pro-rata — they
// can recover at most 90% of what they put in (the other 10% is the VRF lottery):
//
//     paid    0.0100 per $1 of volume
//     recover 0.0027 per $1 of volume   (0.9 x 0.0030)
//     net    -0.0073 per $1 of volume
//
// Wash trading is therefore lossy by a factor of ~3.7x, and it stays lossy at any
// volume, at any share of the board, and at any pot size, because both sides of
// the ratio scale with volume — it cannot be grown out of. A token creator
// self-dealing their own token recovers their 0.20% owner fee and so pays 0.80%
// instead of 1.00%, which is still ~3x more than they can take back.
//
// The invariant to preserve if these numbers are ever retuned:
//
//     leaderboard_share_of_fee x 0.9  <  total_fee_charged
//
// It holds with enormous margin today (0.30% x 0.9 = 0.27% vs 1.00%). If the
// leaderboard's cut of the fee were ever raised above ~90% of the total fee, or
// points were credited for anything not charged a fee, farming would flip
// positive and this whole model would have to be revisited.
//
// What volume scoring genuinely does cost: it is a DILUTION vector rather than a
// profit vector. A farmer who is happy to lose 0.73% of their churn can buy a
// larger slice of the pot and shrink everyone else's. They pay real money to the
// treasury for the privilege, which is the trade being accepted here.
//
// ---------------------------------------------------------------------------
// WHY GRANTS ARE CAPPED
//
// Quest/achievement/referral grants are flat constants that arrive with zero
// trading and therefore zero fee inflow, while the pot they claim a share of is
// funded solely by the 0.3% leaderboard fee. Uncapped, a wallet that never
// traded could mint a claim on real BNB — a faucet paid for by people who did
// trade. Grants are therefore capped at GRANT_CAP_RATIO x the user's earned
// (volume) points: bonuses AMPLIFY real participation instead of substituting
// for it, and a wallet that never traded scores zero no matter how many quests
// it completes.
//
// Tune GRANT_CAP_RATIO to change how much bonuses can matter; set it very high
// to restore the old uncapped behaviour (and the faucet with it).

/// Grants may contribute at most this multiple of a user's traded-volume points.
///
/// INFINITY = uncapped: quest/achievement/referral points count in full, so the
/// leaderboard always equals the Rewards Hub and a user who completes a quest
/// sees every point of it. This is a deliberate product decision, taken with the
/// trade-off understood.
///
/// The trade-off, recorded so it is not rediscovered the hard way: grants arrive
/// with no trading and therefore no fee inflow, while the pot they claim a share
/// of is funded solely by the 0.3% leaderboard fee. Uncapped, a throwaway wallet
/// can create a token (no minimum buy) and make one dust trade to bank ~38 points
/// for gas — roughly $0.10 — and 100 such wallets claim ~3,800 points against a
/// pot other people paid for. Nothing else in the system prices that: the payout
/// floor is 1 point, and the fee argument above constrains only the VOLUME half of
/// the score — a grant is credited without any fee having been paid.
///
/// Set this to a finite number to re-tie grants to real trading (10.0 => $10 of
/// volume unlocks up to 100 points of grants; a wallet that never traded unlocks
/// nothing at any finite ratio). That is the single lever if sybil farming appears.
pub const GRANT_CAP_RATIO: f64 = f64::INFINITY;

/// Minimum final points to appear in a payout round. Below this a holder is
/// omitted from the shares posted on-chain.
///
/// This is the lottery's anti-sybil floor as well as a dust filter: the
/// Distributor draws its 10% winner uniformly from the posted participants, one
/// ticket each regardless of size, so the price of a ticket is exactly the cost
/// of clearing this threshold. At the old effective floor (any score rounding to
/// >= 1) a ticket cost cents and the lottery was trivially sybil-captured.
///
/// It also pays for itself in gas: pushing a payout costs ~13k gas (~$0.02 on
/// BSC), so paying a holder owed less than that burns more than it delivers.
///
/// Set to 1.0 so small real traders are included in rounds. That is a deliberate
/// trade: at this floor a lottery ticket is cheap again (the 10% winner is drawn
/// uniformly from posted holders, one ticket each), so sybil capture of the
/// lottery is priced at roughly one wallet's worth of held position per ticket.
/// The pro-rata 90% is unaffected — it is weighted by points, so a cheap wallet
/// wins a correspondingly tiny share. Raise this if lottery farming shows up.
pub fn min_payout_points() -> f64 {
    std::env::var("MIN_PAYOUT_POINTS")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1.0)
}

/// Clamp a window start to something meaningful.
///
/// `epoch_start()` returns 0 until the first round is paid, and the airdrop asks
/// for a lifetime window starting at 0. Volume scoring tolerates that far better
/// than the time-weighted average did (there is no window-length divisor to blow
/// up any more), but the anchor still matters: it decides which trades are in
/// scope, and it keeps the half-open (from, to] window honest at the boundary.
///
/// Anchoring to the first trade the platform ever saw makes the bootstrap window
/// [first trade, now], which is both finite and the honest meaning of "all time".
pub async fn clamp_window_start(
    state: &crate::AppState,
    from: i64,
) -> crate::errors::AppResult<i64> {
    if from > 0 {
        return Ok(from);
    }
    use diesel::sql_types::BigInt;
    use diesel_async::RunQueryDsl;
    let mut conn = state
        .db
        .get()
        .await
        .map_err(|e| crate::errors::AppError::Pool(e.to_string()))?;
    #[derive(diesel::QueryableByName)]
    struct F {
        #[diesel(sql_type = BigInt)]
        t: i64,
    }
    // Windows are half-open — (from, to] — so the anchor must sit one second
    // BEFORE the first trade, otherwise that trade is excluded from the very
    // window it defines and the platform's first trader scores zero volume.
    let f: F = diesel::sql_query(
        "SELECT COALESCE(MIN(traded_at) - 1, extract(epoch FROM now())::bigint) AS t FROM trades",
    )
    .get_result(&mut conn)
    .await?;
    Ok(f.t)
}

/// Points per $1 of USD volume traded. Buys and sells score identically — both
/// are charged the same fee, so both fund the pot they are scored against.
///
/// This is a pure scale factor: shares are pro-rata, so changing it re-scales
/// every user equally and moves nobody's payout. The only thing it genuinely
/// moves is where users sit relative to `min_payout_points()` and to the flat
/// quest/referral grants in `points_ledger`, which are denominated in the same
/// unit — at 1.0, the +25 for an active referral is worth $25 of trading.
pub const POINTS_PER_USD_VOLUME: f64 = 1.0;

/// CTE defining `earned(uid, pts)` — each user's traded USD volume across
/// (`from`, `to`], both sides counted.
///
/// `from` / `to` are unix seconds and MUST be caller-controlled i64s (never user
/// input) since they are inlined; every call site passes either a compile-time
/// constant or a value derived from our own DB / the chain.
///
/// Implementation notes:
///   - `eth_amount * eth_price` is the USD notional of the trade. `trade_type` is
///     deliberately NOT filtered: a sell moves the same notional as a buy, pays
///     the same fee, and so earns the same points.
///   - The window is half-open, (from, to], matching every other window in this
///     module — `epoch_start()` returns the last paid round's `time_end`, and a
///     trade must land in exactly one round, never two.
///   - Volume is banked per trade and never revalued, so nothing here depends on
///     what the user does afterwards. Selling, transferring out, or the token
///     graduating cannot retroactively change points already earned.
pub fn volume_cte(from: i64, to: i64) -> String {
    format!(
        "earned AS ( \
           SELECT swapper_id AS uid, \
                  SUM(eth_amount::float8 * eth_price::float8) * {rate} AS pts \
           FROM trades \
           WHERE traded_at > {from} AND traded_at <= {to} \
           GROUP BY swapper_id \
         )",
        rate = POINTS_PER_USD_VOLUME
    )
}

/// CTE defining `pos(uid, held)` — the USD a user is holding right now, valued at
/// their weighted-average acquisition cost.
///
/// DISPLAY ONLY. This no longer scores anything; it is the "Holding" column on
/// the leaderboard, kept because it is genuinely informative next to volume. It
/// is expensive (a window function over every trade and transfer), so it is
/// deliberately NOT part of `points_with()` — only the one endpoint that renders
/// the column pays for it, via `points_with_held()`.
///
/// Implementation notes, retained from when this drove scoring:
///   - Tokens that LEAVE a wallet by plain ERC20 transfer are subtracted, but
///     tokens that ARRIVE by transfer are deliberately NOT added — the receiver
///     paid nothing, so crediting them at the sender's cost basis would overstate
///     capital committed.
///   - Position is measured in TOKENS HELD per (user, token), valued at cost, not
///     as net USD cash flow: a wallet that bought $100 and dumped at a loss for
///     $50 would otherwise show a permanent +$50 "position" while holding nothing.
///   - Valued at COST, not at the live mark. On a bonding curve a creator can move
///     the price of their own illiquid token at will, so marking to market would
///     let anyone inflate this number by pumping a token they hold.
///   - A token drops out once it GRADUATES to a DEX: trades on the DEX are not
///     indexed, so the derived balance would freeze and misreport forever.
///   - The running balance is floored at zero AT EVERY STEP.
///     `s - LEAST(MIN(s) OVER (...), 0)` is the closed form of
///     `b_i = max(0, b_{i-1} + d_i)` — it clears at the instant a debt is
///     incurred, without a recursive CTE. Flooring only at valuation time left the
///     negative in the running sum as a permanent debt against that token.
pub fn held_cte(to: i64) -> String {
    format!(
        "moves AS ( \
           SELECT swapper_id AS uid, token_id, traded_at AS t, id AS tid, \
                  CASE WHEN trade_type = 'buy' \
                       THEN token_amount::float8 \
                       ELSE -token_amount::float8 END AS d \
           FROM trades WHERE traded_at <= {to} \
           UNION ALL \
           SELECT from_user_id AS uid, token_id, transferred_at AS t, \
                  -id AS tid, -amount::float8 AS d \
           FROM token_transfers \
           WHERE from_user_id IS NOT NULL AND transferred_at <= {to} \
         ), \
         cum AS ( \
           SELECT uid, token_id, t, tid, \
                  SUM(d) OVER (PARTITION BY uid, token_id ORDER BY t, tid \
                               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS s \
           FROM moves \
         ), \
         run AS ( \
           SELECT uid, token_id, t, tid, \
                  s - LEAST(MIN(s) OVER (PARTITION BY uid, token_id ORDER BY t, tid \
                                         ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), \
                            0) AS toks \
           FROM cum \
         ), \
         basis AS ( \
           SELECT swapper_id AS uid, token_id, \
                  SUM(CASE WHEN trade_type = 'buy' \
                           THEN eth_amount::float8 * eth_price::float8 ELSE 0 END) \
                    / NULLIF(SUM(CASE WHEN trade_type = 'buy' \
                                      THEN token_amount::float8 ELSE 0 END), 0) AS usd_per_token \
           FROM trades \
           WHERE traded_at <= {to} \
           GROUP BY swapper_id, token_id \
         ), \
         grad AS ( \
           SELECT id, extract(epoch FROM launched_at)::bigint AS at \
           FROM tokens WHERE launched_at IS NOT NULL \
         ), \
         seg AS ( \
           SELECT r.uid, r.token_id, r.t AS t0, \
                  LEAST( \
                    COALESCE(LEAD(r.t) OVER (PARTITION BY r.uid, r.token_id ORDER BY r.t, r.tid), {to}), \
                    COALESCE(g.at, {to}) \
                  ) AS t1, \
                  GREATEST(r.toks, 0) * COALESCE(b.usd_per_token, 0) AS val, \
                  g.at AS grad_at \
           FROM run r \
             LEFT JOIN basis b ON b.uid = r.uid AND b.token_id = r.token_id \
             LEFT JOIN grad g ON g.id = r.token_id \
         ), \
         pos AS ( \
           SELECT uid, SUM(val) AS held FROM ( \
             SELECT DISTINCT ON (uid, token_id) uid, token_id, \
                    CASE WHEN grad_at IS NULL THEN val ELSE 0 END AS val \
             FROM seg ORDER BY uid, token_id, t0 DESC \
           ) latest GROUP BY uid \
         )"
    )
}

/// CTE defining `grants(uid, pts)` — bonus points from points_ledger inside the
/// window. Kept separate from `earned` so the cap can be applied between them.
pub fn grants_cte(from: i64, to: i64) -> String {
    format!(
        "grants AS ( \
           SELECT user_id AS uid, SUM(amount)::float8 AS pts \
           FROM points_ledger \
           WHERE created_at > to_timestamp({from}) AND created_at <= to_timestamp({to}) \
           GROUP BY user_id \
         )"
    )
}

/// The scored value for a user, given `earned`/`grants` joined as `ea`/`gr`.
///
/// `volume + min(grants, ratio * volume)`, rounded to whole points.
///
/// Rounded via ::numeric because Postgres `round(double precision)` is
/// half-to-even (10.5 -> 10), which is not what "round" means to a user — and
/// this value is a payout weight, not just a label.
pub fn points_expr() -> String {
    format!("round((COALESCE(ea.pts, 0) + {})::numeric)::float8", granted_expr())
}

/// The grant component after the cap. Emitted as a bare sum when uncapped —
/// `LEAST(x, inf)` is not valid SQL, and the planner should not carry a
/// no-op comparison either.
fn granted_expr() -> String {
    if GRANT_CAP_RATIO.is_infinite() {
        "COALESCE(gr.pts, 0)".to_string()
    } else {
        format!(
            "LEAST(COALESCE(gr.pts, 0), {ratio} * COALESCE(ea.pts, 0))",
            ratio = GRANT_CAP_RATIO
        )
    }
}

/// TOTAL points earned — traded volume plus ALL grants, uncapped.
///
/// This is a DISPLAY figure only. It is what a user has accumulated, and it is
/// what the Rewards Hub counts, so showing it on the ranking page keeps the two
/// screens telling the same story. It must never be used to compute a payout
/// share: uncapped grants are exactly the faucet that lets a wallet holding
/// nothing mint a claim on the pot. `points_expr()` remains the only value the
/// Distributor is served.
pub fn points_total_expr() -> String {
    "round((COALESCE(ea.pts, 0) + COALESCE(gr.pts, 0))::numeric)::float8".to_string()
}

/// `FROM users u LEFT JOIN earned ... LEFT JOIN grants ...` — the joins
/// `points_expr()` expects. LEFT so a user with grants but no trades still
/// appears (scoring zero, by design), keeping displayed and paid sets identical.
pub const POINTS_JOINS: &str =
    " LEFT JOIN earned ea ON ea.uid = u.id LEFT JOIN grants gr ON gr.uid = u.id ";

/// Extra join for the holdings column. Only valid alongside `points_with_held()`.
pub const HELD_JOIN: &str = " LEFT JOIN pos po ON po.uid = u.id ";

/// The USD value a user is holding RIGHT NOW, at cost. Display only — points no
/// longer depend on it. Requires `HELD_JOIN`.
pub const HELD_NOW_EXPR: &str = "COALESCE(po.held, 0)";

/// Points the user will have at round close.
///
/// Under volume scoring this is simply the points they already have: volume is
/// banked the instant a trade lands and nothing further accrues by waiting, so
/// there is nothing left to project. It was a real forecast under the old
/// time-weighted model, where an unheld position was worth a fraction of a held
/// one and a fresh buyer would otherwise have seen a demoralising 0.
///
/// Kept as a distinct function so the leaderboard and Rewards Hub payloads do not
/// have to change shape; both now show the same number in both fields, which is
/// the honest answer.
pub fn points_projected_expr(_from: i64, _to: i64, _end: i64) -> String {
    points_expr()
}

/// Unix timestamp of the next round close: the same Monday-08:00-UTC schedule
/// DistributorV2 enforces on-chain (anchor 1785139200, weekly). Kept in sync
/// with `scheduleAnchor`/`period` in foundry/src/DistributorV2.sol — if the
/// contract schedule is changed, change it here too or the countdown lies.
pub const SCHEDULE_ANCHOR: i64 = 1785139200;
pub const SCHEDULE_PERIOD: i64 = 604800;

pub fn next_round_end(now: i64) -> i64 {
    if now < SCHEDULE_ANCHOR {
        return SCHEDULE_ANCHOR;
    }
    SCHEDULE_ANCHOR + ((now - SCHEDULE_ANCHOR) / SCHEDULE_PERIOD + 1) * SCHEDULE_PERIOD
}

/// Full `WITH earned AS (...), grants AS (...)` prefix for a scoring query.
/// Pair with `POINTS_JOINS`.
pub fn points_with(from: i64, to: i64) -> String {
    format!("WITH {}, {} ", volume_cte(from, to), grants_cte(from, to))
}

/// As `points_with`, plus the CTEs behind `HELD_NOW_EXPR`. Pair with
/// `POINTS_JOINS` AND `HELD_JOIN`.
///
/// Only for the surface that actually renders a holdings column — the position
/// machinery is several window functions over every trade and transfer, and no
/// payout depends on it any more.
pub fn points_with_held(from: i64, to: i64) -> String {
    format!(
        "WITH {}, {}, {} ",
        held_cte(to),
        volume_cte(from, to),
        grants_cte(from, to)
    )
}

// ---------------------------------------------------------------------------
// Reward estimation
//
// The old model was a hardcoded constant: reward = points * 0.00001 BNB, shown
// to users as fact ("Each point is worth 0.00001 BNB"). Nothing on-chain read
// that number, so it was a promise backed by nothing — an audit measured it at
// 1.87x more BNB than the 0.3% fee stream can actually fund, and ~130x during
// bootstrap. Volume cancels out of that ratio, so no amount of growth fixes it.
//
// The honest figure is the one the contract itself computes:
//
//     your_reward = 90% of the pot * (your_points / total_points_of_payout_set)
//
// It is always exactly true, self-corrects as BNB moves and as the pot fills,
// needs no tuning, and makes grant dilution visible rather than hidden — if
// bonus points inflate the denominator, everyone's displayed share drops
// accordingly instead of the protocol quietly over-promising.

/// Share of the pot paid pro-rata (the rest is the VRF lottery).
/// Mirrors DistributorV2.percentForDistribute = 9000 bps.
pub const DISTRIBUTE_BPS: f64 = 9000.0;

/// Live BNB balance of the Distributor — the actual pot a round would pay from.
///
/// Cached in Redis for 60s: this is on the leaderboard request path, and the pot
/// only changes as fees trickle in. Returns None if the address is unset or the
/// RPC is unreachable, and callers then show no estimate at all rather than a
/// made-up one.
pub async fn distributor_pot_bnb(state: &crate::AppState) -> Option<f64> {
    use alloy::primitives::Address;
    use alloy::providers::{Provider, ProviderBuilder};
    use redis::AsyncCommands;

    const CACHE_KEY: &str = "distributor:pot_bnb";
    let mut redis = state.redis_conn.clone();
    if let Ok(v) = redis.get::<_, f64>(CACHE_KEY).await {
        return Some(v);
    }

    let addr: Address = std::env::var("DISTRIBUTOR_ADDRESS").ok()?.parse().ok()?;
    let chain = state
        .chains
        .iter()
        .find(|c| c.network == "bsc")
        .or_else(|| state.chains.first())?;
    let provider = ProviderBuilder::new().connect_http(chain.rpc_url.parse().ok()?);
    let wei = provider.get_balance(addr).await.ok()?;
    // f64 is fine here: this is a display estimate, not accounting. The contract
    // does the real arithmetic in wei.
    let bnb = wei.to_string().parse::<f64>().ok()? / 1e18;

    let _: Result<(), _> = redis.set_ex(CACHE_KEY, bnb, 60).await;
    Some(bnb)
}

/// A user's estimated BNB for the current round.
///
/// Zero unless they are actually in the payout set — below `min_payout_points()`
/// they are not posted on-chain at all, so quoting them anything was advertising
/// BNB that could never arrive.
pub fn estimate_reward_bnb(points: f64, payout_total_points: f64, pot_bnb: Option<f64>) -> f64 {
    let Some(pot) = pot_bnb else { return 0.0 };
    if points < min_payout_points() || payout_total_points <= 0.0 || pot <= 0.0 {
        return 0.0;
    }
    pot * (DISTRIBUTE_BPS / 10000.0) * (points / payout_total_points)
}
