//! Integration tests for the money-critical scoring paths:
//!   * `handlers::points` — the canonical leaderboard/payout formula
//!   * `handlers::rewards::active_referral_sql` — the referral activation floor
//!
//! These run the REAL composed SQL against a real Postgres, because that is
//! where the risk lives: every one of these functions returns a `String` that
//! Rust cannot check, and a typo in it silently changes who gets paid BNB.
//!
//! Requires a THROWAWAY database. Without `TEST_DATABASE_URL` every test skips,
//! so `cargo test` still passes on a machine with no Postgres:
//!
//!     createdb -h 127.0.0.1 -p 5434 -U postgres fyuz_test
//!     TEST_DATABASE_URL=postgres://postgres:pw@127.0.0.1:5434/fyuz_test \
//!         cargo test --test scoring
//!
//! Each test builds its own private schema (so they can run in parallel) and
//! drops it on entry, so `setup()` refuses any database whose name does not
//! contain "test".

use forgepad_backend::handlers::points;
use forgepad_backend::handlers::rewards::active_referral_sql;
use tokio_postgres::{Client, NoTls};

/// Connect and re-apply every migration into a schema private to this test.
/// Returns None when no test database is configured, which the caller treats as
/// "skip".
///
/// Per-test schemas rather than a shared `public`: cargo runs tests in parallel
/// by default, and a shared schema that each test wipes on entry would have them
/// deleting each other's fixtures at random.
async fn setup(schema: &str) -> Option<Client> {
    let url = std::env::var("TEST_DATABASE_URL").ok()?;

    // Guard rail, not a formality: this function drops schemas. If
    // TEST_DATABASE_URL is ever pointed at a real database by accident, that is
    // the whole platform gone.
    let db_name = url.rsplit('/').next().unwrap_or("");
    assert!(
        db_name.contains("test"),
        "refusing to run: TEST_DATABASE_URL database {db_name:?} is not named *test*"
    );
    assert!(
        schema.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'),
        "schema name must be a bare identifier"
    );

    let (client, conn) = tokio_postgres::connect(&url, NoTls)
        .await
        .expect("connect to TEST_DATABASE_URL");
    tokio::spawn(async move {
        let _ = conn.await;
    });

    client
        .batch_execute(&format!(
            "DROP SCHEMA IF EXISTS {schema} CASCADE; CREATE SCHEMA {schema}; \
             SET search_path TO {schema};"
        ))
        .await
        .expect("reset schema");

    let mig_dir = concat!(env!("CARGO_MANIFEST_DIR"), "/migrations");
    let mut dirs: Vec<_> = std::fs::read_dir(mig_dir)
        .expect("read migrations")
        .filter_map(|e| e.ok())
        .map(|e| e.path())
        .filter(|p| p.is_dir())
        .collect();
    dirs.sort();
    for d in dirs {
        let up = d.join("up.sql");
        if let Ok(sql) = std::fs::read_to_string(&up) {
            // batch_execute (simple query protocol) so multi-statement files and
            // DO blocks work; sql_query's prepared statements would reject them.
            client
                .batch_execute(&sql)
                .await
                .unwrap_or_else(|e| panic!("migration {}: {e}", up.display()));
        }
    }
    Some(client)
}

/// Skip the test body when no test database is configured.
macro_rules! db {
    ($schema:expr) => {
        match setup($schema).await {
            Some(c) => c,
            None => {
                eprintln!("skipped: TEST_DATABASE_URL not set");
                return;
            }
        }
    };
}

async fn mk_user(c: &Client, address: &str) -> i32 {
    c.query_one(
        "INSERT INTO users (address) VALUES ($1) RETURNING id",
        &[&address],
    )
    .await
    .expect("insert user")
    .get(0)
}

async fn mk_token(c: &Client, creator: i32, addr: &str) -> i32 {
    c.query_one(
        "INSERT INTO tokens (token_address, name, symbol, creator_id, network) \
         VALUES ($1, 'T', 'T', $2, 'bsc') RETURNING id",
        &[&addr, &creator],
    )
    .await
    .expect("insert token")
    .get(0)
}

/// Record a trade worth `usd` at `at`. eth_price is fixed at 1 so eth_amount is
/// the USD notional directly, matching `eth_amount * eth_price` in the scorer.
async fn trade(c: &Client, uid: i32, token: i32, kind: &str, usd: f64, toks: f64, at: i64) {
    let tx = format!("0x{uid:02x}{at:08x}{}", if kind == "buy" { 1 } else { 2 });
    c.execute(
        "INSERT INTO trades (token_id, swapper_id, trade_type, eth_amount, token_amount, \
             eth_price, tx_hash, traded_at) \
         VALUES ($1, $2, $3::text::trade_type, $4::text::numeric, $5::text::numeric, 1, $6, $7)",
        &[
            &token,
            &uid,
            &kind,
            &usd.to_string(),
            &toks.to_string(),
            &tx,
            &at,
        ],
    )
    .await
    .expect("insert trade");
}

async fn grant(c: &Client, uid: i32, amount: f64, reference: &str, at: i64) {
    c.execute(
        "INSERT INTO points_ledger (user_id, source, amount, ref, created_at) \
         VALUES ($1, 'quest', $2, $3, to_timestamp($4))",
        &[&uid, &amount, &reference, &(at as f64)],
    )
    .await
    .expect("insert grant");
}

/// Points exactly as the Distributor is served them.
async fn points_of(c: &Client, uid: i32, from: i64, to: i64) -> f64 {
    let sql = format!(
        "{with} SELECT {points} AS p FROM users u {joins} WHERE u.id = $1",
        with = points::points_with(from, to),
        points = points::points_expr(),
        joins = points::POINTS_JOINS,
    );
    c.query_one(&sql, &[&uid]).await.expect("points query").get(0)
}

/// USD currently held, via the display-only holdings CTEs.
async fn held_of(c: &Client, uid: i32, from: i64, to: i64) -> f64 {
    let sql = format!(
        "{with} SELECT {held} AS h FROM users u {joins}{held_join} WHERE u.id = $1",
        with = points::points_with_held(from, to),
        held = points::HELD_NOW_EXPR,
        joins = points::POINTS_JOINS,
        held_join = points::HELD_JOIN,
    );
    c.query_one(&sql, &[&uid]).await.expect("held query").get(0)
}

async fn active_referrals_of(c: &Client, uid: i32) -> i64 {
    let sql = format!(
        "SELECT COUNT(*)::bigint FROM referrals r WHERE r.referrer_id = $1 AND {active}",
        active = active_referral_sql("r")
    );
    c.query_one(&sql, &[&uid]).await.expect("referral query").get(0)
}

async fn refer(c: &Client, referrer: i32, referee: i32) {
    c.execute(
        "INSERT INTO referrals (referrer_id, referee_id) VALUES ($1, $2)",
        &[&referrer, &referee],
    )
    .await
    .expect("insert referral");
}

// ---------------------------------------------------------------------------
// Volume scoring
// ---------------------------------------------------------------------------

/// The headline of the model: a sell earns exactly as much as a buy.
#[tokio::test]
async fn buys_and_sells_both_earn() {
    let c = db!("s_buys_sells");
    let u = mk_user(&c, "0xaa").await;
    let t = mk_token(&c, u, "0xt1").await;

    trade(&c, u, t, "buy", 100.0, 10.0, 1100).await;
    trade(&c, u, t, "sell", 60.0, 6.0, 1200).await;

    // $160 of notional moved, not $40 of net exposure.
    assert_eq!(points_of(&c, u, 1000, 2000).await, 160.0);
}

/// Holding is not required, and exiting does not claw anything back.
#[tokio::test]
async fn exiting_the_position_keeps_the_points() {
    let c = db!("s_exiting");
    let u = mk_user(&c, "0xbb").await;
    let t = mk_token(&c, u, "0xt2").await;

    trade(&c, u, t, "buy", 50.0, 5.0, 1100).await;
    trade(&c, u, t, "sell", 50.0, 5.0, 1150).await;

    assert_eq!(points_of(&c, u, 1000, 2000).await, 100.0);
    // Holding really is zero — the points are not a side effect of a stale
    // position lingering in the balance derivation.
    assert_eq!(held_of(&c, u, 1000, 2000).await, 0.0);
}

/// Windows are half-open, (from, to]. A trade must score in exactly one round:
/// on the boundary it belongs to the round that is closing, never both.
#[tokio::test]
async fn window_is_half_open() {
    let c = db!("s_window");
    let u = mk_user(&c, "0xcc").await;
    let t = mk_token(&c, u, "0xt3").await;

    trade(&c, u, t, "buy", 7.0, 1.0, 1000).await; // == from, excluded
    trade(&c, u, t, "buy", 11.0, 1.0, 2000).await; // == to, included

    assert_eq!(points_of(&c, u, 1000, 2000).await, 11.0);
    // The excluded trade is not lost, it scores in the PREVIOUS round.
    assert_eq!(points_of(&c, u, 900, 1000).await, 7.0);
}

/// Trades outside the round contribute nothing — the board really does reset.
#[tokio::test]
async fn earlier_rounds_do_not_carry() {
    let c = db!("s_rounds");
    let u = mk_user(&c, "0xdd").await;
    let t = mk_token(&c, u, "0xt4").await;

    trade(&c, u, t, "buy", 500.0, 50.0, 500).await;

    assert_eq!(points_of(&c, u, 1000, 2000).await, 0.0);
}

// ---------------------------------------------------------------------------
// Grants
// ---------------------------------------------------------------------------

/// Grants are added on top of volume, and are windowed by `created_at` so a
/// quest completed in an earlier round does not keep paying every week.
#[tokio::test]
async fn grants_add_and_are_windowed() {
    let c = db!("s_grants_window");
    let u = mk_user(&c, "0xee").await;
    let t = mk_token(&c, u, "0xt5").await;

    trade(&c, u, t, "buy", 30.0, 3.0, 1100).await;
    grant(&c, u, 25.0, "quest:refer_trader", 1500).await;
    grant(&c, u, 99.0, "quest:old", 500).await; // previous round

    assert_eq!(points_of(&c, u, 1000, 2000).await, 55.0);
}

/// Documents the accepted trade-off: GRANT_CAP_RATIO is INFINITY, so a wallet
/// that has never traded can still score. If that is ever re-tied to real
/// volume, this test is the one that will fail and say so.
#[tokio::test]
async fn grants_are_uncapped_today() {
    let c = db!("s_grants_uncapped");
    let u = mk_user(&c, "0xff").await;

    grant(&c, u, 25.0, "quest:refer_trader", 1500).await;

    assert!(points::GRANT_CAP_RATIO.is_infinite());
    assert_eq!(points_of(&c, u, 1000, 2000).await, 25.0);
}

// ---------------------------------------------------------------------------
// The invariant that matters most: displayed == paid
// ---------------------------------------------------------------------------

/// The leaderboard, the Rewards Hub projection and the Distributor share must
/// be the same number. When they drifted apart before, the platform advertised
/// a payout the contract would not honour.
#[tokio::test]
async fn every_surface_scores_identically() {
    let c = db!("s_surfaces");
    let u = mk_user(&c, "0x11").await;
    let t = mk_token(&c, u, "0xt6").await;

    trade(&c, u, t, "buy", 100.0, 10.0, 1100).await;
    trade(&c, u, t, "sell", 40.0, 4.0, 1200).await;
    grant(&c, u, 5.0, "quest:first_buy", 1500).await;

    let sql = format!(
        "{with} SELECT {points} AS p, {total} AS pt, {proj} AS pp \
         FROM users u {joins} WHERE u.id = $1",
        with = points::points_with(1000, 2000),
        points = points::points_expr(),
        total = points::points_total_expr(),
        proj = points::points_projected_expr(1000, 2000, 3000),
        joins = points::POINTS_JOINS,
    );
    let row = c.query_one(&sql, &[&u]).await.expect("all-surfaces query");
    let (paid, total, projected): (f64, f64, f64) = (row.get(0), row.get(1), row.get(2));

    assert_eq!(paid, 145.0);
    assert_eq!(total, paid, "Rewards Hub total must equal the paid figure");
    // Volume is banked on the trade, so there is nothing left to project.
    assert_eq!(projected, paid, "projection must equal accrued under volume scoring");
}

// ---------------------------------------------------------------------------
// Referral activation floor
// ---------------------------------------------------------------------------

/// $50 NET bought, or the referral is worth nothing anywhere.
#[tokio::test]
async fn referral_needs_fifty_net_to_activate() {
    let c = db!("s_ref_floor");
    let referrer = mk_user(&c, "0x21").await;
    let t = mk_token(&c, referrer, "0xt7").await;

    let under = mk_user(&c, "0x22").await;
    let exact = mk_user(&c, "0x23").await;
    let dumped = mk_user(&c, "0x24").await;
    for u in [under, exact, dumped] {
        refer(&c, referrer, u).await;
    }

    trade(&c, under, t, "buy", 49.99, 5.0, 1100).await;
    trade(&c, exact, t, "buy", 50.0, 5.0, 1100).await;
    // Buys $100 then sells $60 — plenty of VOLUME, but only $40 net committed.
    trade(&c, dumped, t, "buy", 100.0, 10.0, 1100).await;
    trade(&c, dumped, t, "sell", 60.0, 6.0, 1200).await;

    assert_eq!(active_referrals_of(&c, referrer).await, 1);
}

/// A referee who clears the floor and then exits stops counting — the floor is
/// a standing condition, not a one-time gate.
#[tokio::test]
async fn referral_deactivates_when_referee_exits() {
    let c = db!("s_ref_exit");
    let referrer = mk_user(&c, "0x31").await;
    let referee = mk_user(&c, "0x32").await;
    let t = mk_token(&c, referrer, "0xt8").await;
    refer(&c, referrer, referee).await;

    trade(&c, referee, t, "buy", 80.0, 8.0, 1100).await;
    assert_eq!(active_referrals_of(&c, referrer).await, 1);

    trade(&c, referee, t, "sell", 50.0, 5.0, 1200).await; // net $30
    assert_eq!(active_referrals_of(&c, referrer).await, 0);
}

/// Referring yourself never counts, whatever you trade.
#[tokio::test]
async fn self_referral_never_counts() {
    let c = db!("s_ref_self");
    let u = mk_user(&c, "0x41").await;
    let t = mk_token(&c, u, "0xt9").await;
    refer(&c, u, u).await;

    trade(&c, u, t, "buy", 5000.0, 500.0, 1100).await;

    assert_eq!(active_referrals_of(&c, u).await, 0);
}
