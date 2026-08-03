//! Trading: calldata encoding, quotes, slippage and revert classification.
//!
//! The encoding half is driven by `shared/test-vectors/trade-calldata.json`,
//! whose expected hex came out of `cast calldata`. Four hand-written ABI
//! encoders agreeing with foundry is the only reason to trust any of them.

mod common;

use std::time::Duration;

use common::{StubResponse, StubServer};
use fyuz::{
    address_word, format_units, normalize_address, parse_units, revert_error, BuyExactTokensParams,
    BuyParams, Error, FyuzClient, RevertKind, SellParams, SELECTOR_ALLOWANCE, SELECTOR_APPROVE,
    SELECTOR_BALANCE_OF, SELECTOR_GET_FIRST_BUY_FEE, SELECTOR_GET_MAX_SELLABLE_ETH,
    SELECTOR_GET_SWAP_OUTPUT, SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
    SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS, SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH, SELECTOR_TOKEN_POOLS,
    U256,
};
use serde_json::Value;

const CALLDATA_VECTOR: &str = include_str!("../../shared/test-vectors/trade-calldata.json");
const TRADE_ERROR_VECTOR: &str = include_str!("../../shared/test-vectors/trade-errors.json");

const CHAIN_CONFIG: &str = r#"{"chains":[{"name":"BNB Smart Chain","chainId":56,"network":"bsc",
"contractAddress":"0x33A98BeF6496684a8daC83734D9CEB0CEFC7019c","currency":"BNB",
"explorerUrl":"https://bscscan.com"}]}"#;

fn calldata_vector() -> Value {
    serde_json::from_str(CALLDATA_VECTOR).expect("parse trade-calldata.json")
}

fn fixture(vector: &Value, name: &str) -> Value {
    vector["cases"]
        .as_array()
        .expect("cases")
        .iter()
        .find(|case| case["name"] == name)
        .unwrap_or_else(|| panic!("fixture {name} missing from trade-calldata.json"))
        .clone()
}

/// A fixture argument, whether the JSON spells it as a string or a number.
fn arg(case: &Value, name: &str) -> String {
    match &case["args"][name] {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn amount(case: &Value, name: &str) -> U256 {
    U256::from_dec_str(name, &arg(case, name)).expect("fixture amount")
}

fn word(value: u64) -> String {
    U256::from_u64(value).to_hex_word()
}

fn swap_output_result(amount_out: U256, impact_bps: u64) -> String {
    format!("0x{}{}", amount_out.to_hex_word(), word(impact_bps))
}

/// `tokenPools` return data — eight words, with `launched` last.
fn token_pools_result(launched: bool) -> String {
    format!("0x{}{}", word(0).repeat(7), word(u64::from(launched)))
}

/// Serves `/config` over REST and everything else as JSON-RPC, on one server.
///
/// The stub answers by queue order, so each test lists exactly the responses its
/// call sequence will consume.
async fn stub_client(responses: Vec<StubResponse>) -> (StubServer, FyuzClient) {
    let mut queued = vec![StubResponse::ok(CHAIN_CONFIG)];
    queued.extend(responses);
    let server = StubServer::start(queued).await;

    let client = FyuzClient::builder()
        .base_url(&server.base_url)
        .expect("stub base url")
        .rpc_url(format!("{}/rpc", server.base_url))
        .rpc_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(5))
        .build()
        .expect("build client");

    (server, client)
}

/// The calldata of the nth JSON-RPC request the stub received.
fn rpc_calldata(server: &StubServer, index: usize) -> String {
    let body: Value = serde_json::from_str(&server.request(index).body).expect("rpc body");
    body["params"][0]["data"]
        .as_str()
        .expect("calldata")
        .to_string()
}

#[tokio::test]
async fn buy_exact_bnb_matches_the_golden_calldata() {
    let vector = calldata_vector();
    let case = fixture(&vector, "buy_exact_bnb");
    let min_out = amount(&case, "minAmountOut");
    let buy_amount = amount(&case, "buyAmount");

    // amount_out is exactly the fixture's minAmountOut, so an explicit limit
    // reproduces the golden calldata with no rounding in the way.
    let (_server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(min_out, 120)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(0)
        )),
    ])
    .await;

    let built = client
        .trade()
        .build_buy(
            &BuyParams::new(arg(&case, "token"), buy_amount)
                .limit_wei(min_out)
                .deadline(
                    vector["fixture_args"]["deadline"]
                        .as_u64()
                        .expect("deadline"),
                ),
        )
        .await
        .expect("build_buy");

    assert_eq!(built.transaction.data, case["calldata"].as_str().unwrap());
    assert_eq!(
        built.transaction.to,
        vector["contract"]["bsc"].as_str().unwrap()
    );
    assert_eq!(built.transaction.chain_id, 56);
    assert_eq!(built.transaction.value, buy_amount, "the fee is zero here");
}

#[tokio::test]
async fn sell_exact_tokens_matches_the_golden_calldata() {
    let vector = calldata_vector();
    let case = fixture(&vector, "sell_exact_tokens");
    let min_out = amount(&case, "minAmountOut");

    let (_server, client) = stub_client(vec![StubResponse::ok(format!(
        r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
        swap_output_result(min_out, 90)
    ))])
    .await;

    let built = client
        .trade()
        .build_sell(
            &SellParams::new(arg(&case, "token"), amount(&case, "sellAmount"))
                .limit_wei(min_out)
                .deadline(vector["fixture_args"]["deadline"].as_u64().unwrap()),
        )
        .await
        .expect("build_sell");

    assert_eq!(built.transaction.data, case["calldata"].as_str().unwrap());
    assert_eq!(
        built.transaction.value,
        U256::ZERO,
        "selling is not payable"
    );
}

#[tokio::test]
async fn buy_exact_tokens_matches_the_golden_calldata() {
    let vector = calldata_vector();
    let case = fixture(&vector, "buy_exact_tokens");
    let max_in = amount(&case, "maxAmountIn");

    let (_server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(max_in, 0)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(0)
        )),
    ])
    .await;

    let built = client
        .trade()
        .build_buy_exact_tokens(
            &BuyExactTokensParams::new(arg(&case, "token"), amount(&case, "buyAmount"))
                .limit_wei(max_in)
                .deadline(vector["fixture_args"]["deadline"].as_u64().unwrap()),
        )
        .await
        .expect("build_buy_exact_tokens");

    assert_eq!(built.transaction.data, case["calldata"].as_str().unwrap());
}

#[tokio::test]
async fn approve_matches_the_golden_calldata() {
    let vector = calldata_vector();
    let exact = fixture(&vector, "approve_exact");
    let unlimited = fixture(&vector, "approve_unlimited");
    let (_server, client) = stub_client(vec![]).await;
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let built = client
        .trade()
        .build_approve("bsc", token, amount(&exact, "amount"))
        .await
        .expect("build_approve");
    assert_eq!(built.data, exact["calldata"].as_str().unwrap());
    assert_eq!(built.to, token, "approve targets the token, not the curve");

    let built_max = client
        .trade()
        .build_approve("bsc", token, U256::MAX)
        .await
        .expect("build_approve unlimited");
    assert_eq!(built_max.data, unlimited["calldata"].as_str().unwrap());
}

#[tokio::test]
async fn quotes_and_reads_match_the_golden_calldata() {
    let vector = calldata_vector();
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let (server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(U256::from_u64(1), 1)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(0)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":3,"result":"{}"}}"#,
            swap_output_result(U256::from_u64(1), 1)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":4,"result":"0x{}"}}"#,
            word(42)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":5,"result":"{}"}}"#,
            token_pools_result(false)
        )),
    ])
    .await;

    let buy_case = fixture(&vector, "quote_buy");
    client
        .trade()
        .quote_buy("bsc", token, amount(&buy_case, "amountIn"))
        .await
        .expect("quote_buy");

    let sell_case = fixture(&vector, "quote_sell");
    client
        .trade()
        .quote_sell("bsc", token, amount(&sell_case, "amountIn"))
        .await
        .expect("quote_sell");

    let allowance_case = fixture(&vector, "allowance");
    let allowance = client
        .trade()
        .allowance("bsc", token, &arg(&allowance_case, "owner"))
        .await
        .expect("allowance");
    assert_eq!(allowance, U256::from_u64(42));

    assert!(!client
        .trade()
        .is_graduated("bsc", token)
        .await
        .expect("is_graduated"));

    // Request 0 is the REST /config fetch; the RPC calls follow in order.
    assert_eq!(
        rpc_calldata(&server, 1),
        buy_case["calldata"].as_str().unwrap()
    );
    assert_eq!(
        rpc_calldata(&server, 3),
        sell_case["calldata"].as_str().unwrap()
    );
    assert_eq!(
        rpc_calldata(&server, 4),
        allowance_case["calldata"].as_str().unwrap()
    );
    assert_eq!(
        rpc_calldata(&server, 5),
        fixture(&vector, "token_pools")["calldata"]
            .as_str()
            .unwrap()
    );
}

#[test]
fn selectors_match_the_fixture() {
    // Catches a mistyped constant, which would otherwise send a transaction to
    // whatever function happened to share the wrong four bytes.
    let vector = calldata_vector();
    let selectors = &vector["selectors"];

    for (signature, expected) in [
        (
            "swapExactETHForTokens(address,uint256,uint256,uint256)",
            SELECTOR_SWAP_EXACT_ETH_FOR_TOKENS,
        ),
        (
            "swapETHForExactTokens(address,uint256,uint256,uint256)",
            SELECTOR_SWAP_ETH_FOR_EXACT_TOKENS,
        ),
        (
            "swapExactTokensForETH(address,uint256,uint256,uint256)",
            SELECTOR_SWAP_EXACT_TOKENS_FOR_ETH,
        ),
        (
            "getSwapOutput(address,uint256,bool)",
            SELECTOR_GET_SWAP_OUTPUT,
        ),
        ("getFirstBuyFee(address)", SELECTOR_GET_FIRST_BUY_FEE),
        ("getMaxSellableETH(address)", SELECTOR_GET_MAX_SELLABLE_ETH),
        ("tokenPools(address)", SELECTOR_TOKEN_POOLS),
        ("approve(address,uint256)", SELECTOR_APPROVE),
        ("allowance(address,address)", SELECTOR_ALLOWANCE),
        ("balanceOf(address)", SELECTOR_BALANCE_OF),
    ] {
        assert_eq!(
            selectors[signature].as_str().unwrap(),
            expected,
            "{signature}"
        );
    }
}

#[test]
fn mixed_case_address_encodes_lowercased() {
    let vector = calldata_vector();
    let casing = &vector["address_casing"];
    assert_eq!(
        address_word(casing["mixed_case_input"].as_str().unwrap()),
        casing["encoded_word"].as_str().unwrap()
    );
}

#[tokio::test]
async fn first_buy_fee_lands_on_value_not_on_the_amount_swapped() {
    let vector = calldata_vector();
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let (_server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(U256::from_u64(1000), 250)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(7_000_000_000_000_000)
        )),
    ])
    .await;

    let quote = client
        .trade()
        .quote_buy("bsc", token, parse_units("0.5", 18).unwrap())
        .await
        .expect("quote_buy");

    assert_eq!(quote.amount_in_wei.to_string(), "500000000000000000");
    assert_eq!(quote.first_buy_fee_wei.to_string(), "7000000000000000");
    assert_eq!(quote.value_wei.to_string(), "507000000000000000");
    assert_eq!(quote.price_impact_bps, 250);
}

#[tokio::test]
async fn refuses_a_graduated_token() {
    let errors: Value = serde_json::from_str(TRADE_ERROR_VECTOR).expect("parse trade-errors.json");
    let selector = errors["graduated_selector"].as_str().unwrap();
    let vector = calldata_vector();
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let (_server, client) = stub_client(vec![StubResponse::ok(format!(
        r#"{{"jsonrpc":"2.0","id":1,"error":{{"code":3,"message":"execution reverted","data":"{selector}"}}}}"#
    ))])
    .await;

    let error = client
        .trade()
        .build_buy(&BuyParams::new(token, parse_units("0.5", 18).unwrap()).slippage_bps(100))
        .await
        .expect_err("should refuse a graduated token");

    assert!(error.is_graduated(), "got {error:?}");
    assert!(error.to_string().contains("graduated"));
}

#[tokio::test]
async fn slippage_moves_the_limit_the_right_way() {
    let vector = calldata_vector();
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let (_server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(U256::from_u64(1_000_000), 100)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(0)
        )),
    ])
    .await;

    let built = client
        .trade()
        .build_buy(&BuyParams::new(token, parse_units("1", 18).unwrap()).slippage_bps(100))
        .await
        .expect("build_buy");
    assert_eq!(built.limit_wei.to_string(), "990000", "1% below the quote");
}

#[tokio::test]
async fn slippage_is_required() {
    let vector = calldata_vector();
    let token = vector["fixture_args"]["token"].as_str().unwrap();

    let (_server, client) = stub_client(vec![
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":1,"result":"{}"}}"#,
            swap_output_result(U256::from_u64(1000), 0)
        )),
        StubResponse::ok(format!(
            r#"{{"jsonrpc":"2.0","id":2,"result":"0x{}"}}"#,
            word(0)
        )),
    ])
    .await;

    let error = client
        .trade()
        .build_buy(&BuyParams::new(token, parse_units("1", 18).unwrap()))
        .await
        .expect_err("should refuse to pick a tolerance");

    assert!(
        error
            .to_string()
            .contains("slippage protection is required"),
        "got {error}"
    );
}

#[test]
fn revert_classification_matches_the_shared_table() {
    let vector: Value = serde_json::from_str(TRADE_ERROR_VECTOR).expect("parse trade-errors.json");

    for case in vector["decode_cases"].as_array().expect("decode_cases") {
        let name = case["name"].as_str().unwrap();
        let error = revert_error(case["revert_data"].as_str().unwrap(), "getSwapOutput(0x…)");

        let Error::ContractRevert {
            kind,
            error_name,
            message,
            ..
        } = &error
        else {
            panic!("{name}: expected a ContractRevert, got {error:?}");
        };

        assert_eq!(
            kind.as_str(),
            case["expect"]["surfaced_as"].as_str().unwrap(),
            "{name}"
        );
        if let Some(expected) = case["expect"]["error"].as_str() {
            assert_eq!(error_name.as_deref(), Some(expected), "{name}");
        }
        if let Some(expected) = case["expect"]["message"].as_str() {
            assert!(message.contains(expected), "{name}: {message}");
        }
        if let Some(expected) = case["expect"]["message_contains"].as_str() {
            assert!(message.contains(expected), "{name}: {message}");
        }
    }

    for entry in vector["revertible"].as_array().expect("revertible") {
        let error = revert_error(entry["selector"].as_str().unwrap(), "call");
        let Error::ContractRevert {
            kind,
            error_name,
            retryable,
            ..
        } = &error
        else {
            panic!("expected a ContractRevert for {}", entry["error"]);
        };
        assert_eq!(kind.as_str(), entry["surfaced_as"].as_str().unwrap());
        assert_eq!(error_name.as_deref(), entry["error"].as_str());
        assert_eq!(*retryable, entry["retryable"].as_bool().unwrap());
    }
}

#[test]
fn u256_covers_the_whole_uint256_range() {
    // An unlimited ERC-20 allowance is the single most common large value there
    // is, and a u128-based decoder would fail on exactly that.
    let max = "115792089237316195423570985008687907853269984665640564039457584007913129639935";
    assert_eq!(U256::MAX.to_string(), max);
    assert_eq!(U256::from_dec_str("v", max).unwrap(), U256::MAX);
    assert_eq!(U256::MAX.to_hex_word(), "f".repeat(64));
    assert!(U256::MAX.checked_add(U256::from_u64(1)).is_none());
    assert!(U256::from_dec_str("v", "1")
        .unwrap()
        .checked_sub(U256::from_u64(2))
        .is_none());
}

#[test]
fn units_round_trip_without_touching_a_float() {
    for (decimal, wei) in [
        ("0.5", "500000000000000000"),
        ("1", "1000000000000000000"),
        ("0.000000000000000001", "1"),
        // 0.1 + 0.2 in binary floating point is the classic wrong answer; this
        // path never converts to a float, so it is not.
        ("0.30000000000000004", "300000000000000040"),
    ] {
        let parsed = parse_units(decimal, 18).expect(decimal);
        assert_eq!(parsed.to_string(), wei, "parse_units({decimal})");
        assert_eq!(format_units(parsed, 18), decimal, "format_units round trip");
    }

    assert!(parse_units("1.0000000000000000001", 18).is_err());
    assert!(U256::from_dec_str("amount_wei", "0.5").is_err());
    assert!(normalize_address("token", "0xdead").is_err());
}

#[test]
fn revert_kind_strings_cover_the_table() {
    assert_eq!(RevertKind::Graduated.as_str(), "graduated");
    assert_eq!(RevertKind::Slippage.as_str(), "slippage");
    assert_eq!(RevertKind::Unknown.as_str(), "unknown");
}
