//! Integration test for `services::blockchain::curve_token_balance` — the
//! bonding curve's share of a token, which is the first row of every
//! top-holders list.
//!
//! This is tested against a real chain because the failure it exists to prevent
//! is precisely a *silent* one: the browser read it replaces returned `0n` on
//! every error path, so a curve holding 100% of supply rendered a confident
//! "0 %". A mocked RPC would happily reproduce the encoding bug and prove
//! nothing. What matters is that the real selector, against the real contract,
//! decodes to the real number.
//!
//! Requires a BSC endpoint. Without `TEST_BSC_RPC_URL` every test skips, so
//! `cargo test` still passes offline:
//!
//!     TEST_BSC_RPC_URL=https://... cargo test --test curve_balance

use bigdecimal::BigDecimal;
use forgepad_backend::config::chains::ChainConfig;
use forgepad_backend::services::blockchain::curve_token_balance;
use std::str::FromStr;

/// BSC mainnet Fyuz curve — the contract that holds unsold supply.
const CURVE: &str = "0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c";

/// "Taco Tut" — untraded, so the curve holds the entire 1e9 supply. This is the
/// exact token that was reported rendering "0 %", which makes it the one case
/// worth pinning: the correct answer here is the maximum, not zero.
const UNTRADED_TOKEN: &str = "0x1b866658d97fd7d71fe2afcc34cf26099d81c5c9";

/// "Kim Jong Chu" — traded, so the curve holds strictly less than supply. Guards
/// the opposite mistake: a stub that always returns total supply would pass the
/// untraded case alone.
const TRADED_TOKEN: &str = "0x42322852a918f94186b7dfda2e0e3f4ad3528480";

fn rpc() -> Option<String> {
    std::env::var("TEST_BSC_RPC_URL").ok().filter(|s| !s.is_empty())
}

fn chain(rpc_url: String) -> ChainConfig {
    ChainConfig {
        name: "BNB Smart Chain".into(),
        network: "bsctest".into(), // not "bsc": keeps <NET>_RPC_URL env off this test
        chain_id: 56,
        currency: "BNB".into(),
        rpc_url,
        ws_url: None,
        explorer_url: "https://bscscan.com".into(),
        contract_address: CURVE.into(),
        start_block: 0,
        abi: serde_json::Value::Null,
        virtual_eth_amount: 8.25,
        virtual_token_amount: 1_073_000_000.0,
        total_supply: 1_000_000_000.0,
        target_market_cap: 30_000.0,
        pools: vec![],
    }
}

#[tokio::test]
async fn untraded_token_reports_the_full_supply_not_zero() {
    let Some(rpc_url) = rpc() else {
        eprintln!("skipping: TEST_BSC_RPC_URL not set");
        return;
    };
    let bal = curve_token_balance(&chain(rpc_url), UNTRADED_TOKEN)
        .await
        .expect("curve balance read");

    // Whole tokens, not wei: 1e9, not 1e27.
    assert_eq!(
        bal.normalized(),
        BigDecimal::from_str("1000000000").unwrap().normalized(),
        "untraded curve should hold all 1e9 tokens (got {bal})"
    );
}

#[tokio::test]
async fn traded_token_reports_less_than_supply() {
    let Some(rpc_url) = rpc() else {
        eprintln!("skipping: TEST_BSC_RPC_URL not set");
        return;
    };
    let bal = curve_token_balance(&chain(rpc_url), TRADED_TOKEN)
        .await
        .expect("curve balance read");

    let supply = BigDecimal::from_str("1000000000").unwrap();
    assert!(bal < supply, "traded curve should hold < supply (got {bal})");
    // Sanity floor: these are small tokens, the curve still holds most of them.
    // A decimal-scaling bug (÷1e18 twice) would land far below this.
    assert!(
        bal > BigDecimal::from_str("900000000").unwrap(),
        "curve balance implausibly low, check wei scaling (got {bal})"
    );
}

#[tokio::test]
async fn a_non_token_address_errors_rather_than_reporting_zero() {
    let Some(rpc_url) = rpc() else {
        eprintln!("skipping: TEST_BSC_RPC_URL not set");
        return;
    };
    // The curve contract itself has no `balanceOf`. The whole point of this
    // change is that a read which cannot answer must NOT answer "0".
    let res = curve_token_balance(&chain(rpc_url), CURVE).await;
    assert!(
        res.is_err(),
        "expected an error, got {res:?} — a failed read must never surface as a balance"
    );
}
