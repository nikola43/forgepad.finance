// Canonical leaderboard scoring. THE single definition of "points".
//
// Every surface that scores users — the payout shares served to the Distributor
// contract, the leaderboard, the season table, the airdrop allocation — builds
// its query from here. They previously each carried their own copy of the
// formula and had drifted apart, so what a user was shown was not what the
// contract paid on.
//
// ---------------------------------------------------------------------------
// WHY TIME-WEIGHTED
//
// The old score was `max(0, buy_usd - sell_usd)` summed over the round window.
// Three things were wrong with it, all exploitable:
//
//   1. It measured the CLOSING balance, not the position actually held. A wallet
//      could buy $30k one minute before the weekly snapshot, be scored for the
//      full $30k, and sell the moment the round opened — the sell landed in the
//      NEXT window where, having no buys, it was floored to zero and cost
//      nothing. Leaderboard weight was purchasable for ~2 cents per point with
//      seconds of market exposure.
//   2. The `max(0, ...)` floor was applied per-window, so a loss never carried.
//      Exiting a position was always free.
//   3. It ignored trades before the window entirely, so a genuine long-term
//      holder who simply held scored ZERO while a boundary-timer scored full.
//
// Time-weighting fixes all three at once, because it prices TIME, which cannot
// be bought back:
//
//     points = (1/T) * ∫ max(0, net_position(t)) dt   over the window [from, to]
//
// where net_position(t) is the running sum of (buys - sells) over the user's
// ENTIRE history up to t — not just the window. A position held all week scores
// its full USD value; the same position held for 60 seconds around the snapshot
// scores 60/604800 of it, i.e. essentially nothing. A holder who bought months
// ago and never sold scores in full every week, which is the behaviour the
// product actually wants to reward.
//
// ---------------------------------------------------------------------------
// WHY GRANTS ARE CAPPED
//
// Quest/achievement/referral grants are flat constants that arrive with zero
// trading and therefore zero fee inflow, while the pot they claim a share of is
// funded solely by the 0.3% leaderboard fee. Uncapped, a wallet that never
// traded could mint a claim on real BNB — a faucet paid for by people who did
// trade. Grants are therefore capped at GRANT_CAP_RATIO x the user's earned
// (time-weighted) points: bonuses AMPLIFY real participation instead of
// substituting for it, and a zero-position wallet scores zero no matter how many
// quests it completes.
//
// Tune GRANT_CAP_RATIO to change how much bonuses can matter; set it very high
// to restore the old uncapped behaviour (and the faucet with it).

/// Grants may contribute at most this multiple of a user's time-weighted points.
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
/// floor is 1 point, and time-weighting only constrains the POSITION half of the
/// score, not grants.
///
/// Set this to a finite number to re-tie grants to held capital (10.0 => holding
/// $10 unlocks up to 100 points of grants; a zero-position wallet unlocks nothing
/// at any finite ratio). That is the single lever if sybil farming appears.
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
/// for a lifetime window starting at 0. Feeding 0 into a TIME-WEIGHTED average is
/// not merely imprecise, it is catastrophic: the divisor becomes (now - 1970) =
/// ~56 years, so a real $100 position held for a real week scores 100 * 7/20440
/// = 0.03 points and every single user rounds to zero. The whole leaderboard
/// would silently empty out and no round could ever pay anyone.
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

/// CTE defining `twa(uid, pts)` — each user's time-weighted average net USD
/// position across [`from`, `to`].
///
/// `from` / `to` are unix seconds and MUST be caller-controlled i64s (never user
/// input) since they are inlined; every call site passes either a compile-time
/// constant or a value derived from our own DB / the chain.
///
/// Implementation notes:
///   - The running balance is taken over ALL trades up to `to`, so a position
///     opened before the window still counts while it is held.
///   - `ORDER BY traded_at, id` makes the running sum deterministic when several
///     trades share a timestamp (same block); ties produce zero-length segments
///     which contribute nothing.
///   - Each trade starts a segment that runs until the next trade, or until `to`
///     for the last one. Segments are clamped to the window before weighting, so
///     a trade before `from` contributes only its overlap.
///   - Tokens that LEAVE a wallet by plain ERC20 transfer are subtracted, but
///     tokens that ARRIVE by transfer are deliberately NOT added. A transfer
///     therefore destroys points rather than moving them. That asymmetry is the
///     point: the receiver paid nothing, so crediting them at the sender's cost
///     basis would let a position be laundered between wallets indefinitely —
///     buy, send, sell from the second wallet, repeat. Destroying on transfer
///     makes the laundering strictly lossy.
///   - Position is measured in TOKENS HELD per (user, token), valued at the
///     user's weighted-average acquisition cost — NOT as net USD cash flow.
///     Cash flow was wrong in both directions: a wallet that bought $100 and
///     dumped at a loss for $50 kept a permanent +$50 "position" while holding
///     nothing, and a wallet that sold half at a profit scored ZERO while still
///     holding the other half. Token units cannot drift like that: sell
///     everything and the balance is zero, keep half and half is counted.
///   - A position stops earning the moment its token GRADUATES to a DEX. Trades
///     on the DEX are not indexed, so after graduation the derived balance would
///     freeze at whatever it was and keep scoring forever regardless of what the
///     holder actually did — buy on the curve, graduate, dump on PancakeSwap, and
///     the phantom position pays out every round. Clamping each token's segments
///     at `launched_at` means only time spent on the bonding curve — the part we
///     can actually observe — is ever scored.
///   - Valued at COST, deliberately, not at the live mark. On a bonding curve a
///     creator can move the price of their own illiquid token at will, so
///     marking to market would let anyone mint unbounded points by pumping a
///     token they hold. Cost basis measures capital actually committed, which is
///     what the reward is for, and it cannot be manipulated by price.
///   - The running balance is floored at zero AT EVERY STEP, not just when it is
///     valued. Flooring only at valuation time (`GREATEST(toks, 0)`) stopped the
///     score going negative but left the negative balance itself in the running
///     sum, where it became a permanent DEBT against that token. A wallet that
///     received 1000 tokens by transfer (deliberately not credited) and sold them
///     carried -1000 forever, so a later, entirely genuine $500 buy scored ZERO
///     until it had re-bought the full 1000. The same trap caught anyone holding
///     tokens acquired before indexing began. `s - LEAST(MIN(s) OVER (...), 0)`
///     is the closed form of `b_i = max(0, b_{i-1} + d_i)` — it clears the debt at
///     the instant it is incurred, without a recursive CTE. You cannot hold a
///     negative number of tokens, so no honest history can produce one.
pub fn twa_cte(from: i64, to: i64) -> String {
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
         twa AS ( \
           SELECT uid, \
                  SUM(val * GREATEST(LEAST(t1, {to}) - GREATEST(t0, {from}), 0)) \
                    / NULLIF({to} - {from}, 0)::float8 AS pts \
           FROM seg \
           WHERE t1 > {from} AND t0 < {to} \
           GROUP BY uid \
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
/// window. Kept separate from `twa` so the cap can be applied between them.
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

/// The scored value for a user, given `twa`/`grants` joined as `tw`/`gr`.
///
/// `earned + min(grants, ratio * earned)`, rounded to whole points.
///
/// Rounded via ::numeric because Postgres `round(double precision)` is
/// half-to-even (10.5 -> 10), which is not what "round" means to a user — and
/// this value is a payout weight, not just a label.
pub fn points_expr() -> String {
    format!("round((COALESCE(tw.pts, 0) + {})::numeric)::float8", granted_expr())
}

/// The grant component after the cap. Emitted as a bare sum when uncapped —
/// `LEAST(x, inf)` is not valid SQL, and the planner should not carry a
/// no-op comparison either.
fn granted_expr() -> String {
    if GRANT_CAP_RATIO.is_infinite() {
        "COALESCE(gr.pts, 0)".to_string()
    } else {
        format!(
            "LEAST(COALESCE(gr.pts, 0), {ratio} * COALESCE(tw.pts, 0))",
            ratio = GRANT_CAP_RATIO
        )
    }
}

/// TOTAL points earned — time-weighted position plus ALL grants, uncapped.
///
/// This is a DISPLAY figure only. It is what a user has accumulated, and it is
/// what the Rewards Hub counts, so showing it on the ranking page keeps the two
/// screens telling the same story. It must never be used to compute a payout
/// share: uncapped grants are exactly the faucet that lets a wallet holding
/// nothing mint a claim on the pot. `points_expr()` remains the only value the
/// Distributor is served.
pub fn points_total_expr() -> String {
    "round((COALESCE(tw.pts, 0) + COALESCE(gr.pts, 0))::numeric)::float8".to_string()
}

/// `FROM users u LEFT JOIN twa ... LEFT JOIN grants ...` — the joins
/// `points_expr()` expects. LEFT so a user with grants but no trades still
/// appears (scoring zero, by design), keeping displayed and paid sets identical.
pub const POINTS_JOINS: &str =
    " LEFT JOIN twa tw ON tw.uid = u.id LEFT JOIN grants gr ON gr.uid = u.id \
      LEFT JOIN pos po ON po.uid = u.id ";

/// The USD value a user is holding RIGHT NOW. Updates the instant a trade lands,
/// so the UI has something real-time to show while time-weighted points accrue.
pub const HELD_NOW_EXPR: &str = "COALESCE(po.held, 0)";

/// Points the user will have AT ROUND CLOSE if they hold their current position
/// until then.
///
/// This is the number to lead with in the UI. Raw accrued points are honest but
/// unreadable to a human: someone who buys $2.25 three minutes into a window has
/// genuinely earned ~0.04 points, and telling them "0" reads as broken even
/// though it is correct. The projection answers the question they are actually
/// asking — "what is this position worth to me?" — and it responds the instant
/// they buy.
///
///     projected = (accrued_so_far * (to - from) + held_now * (end - to))
///                 / (end - from)
///
/// i.e. the integral already banked, plus the rectangle they will bank by
/// holding, over the full round. Payouts are still computed from ACCRUED points
/// at snapshot time (`points_expr`); this is guidance, and must be labelled as
/// such wherever it is shown.
pub fn points_projected_expr(from: i64, to: i64, end: i64) -> String {
    let twa_proj = format!(
        "((COALESCE(tw.pts, 0) * ({to} - {from}) + {held} * ({end} - {to})) \
          / NULLIF({end} - {from}, 0)::float8)",
        held = HELD_NOW_EXPR
    );
    let granted = if GRANT_CAP_RATIO.is_infinite() {
        "COALESCE(gr.pts, 0)".to_string()
    } else {
        format!("LEAST(COALESCE(gr.pts, 0), {GRANT_CAP_RATIO} * {twa_proj})")
    };
    format!("round(({twa_proj} + {granted})::numeric)::float8")
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

/// Full `WITH twa AS (...), grants AS (...)` prefix for a scoring query.
pub fn points_with(from: i64, to: i64) -> String {
    format!("WITH {}, {} ", twa_cte(from, to), grants_cte(from, to))
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
