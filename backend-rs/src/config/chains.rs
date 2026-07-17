use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    pub name: String,
    pub network: String,
    pub chain_id: u64,
    pub currency: String,
    pub rpc_url: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ws_url: Option<String>,
    pub explorer_url: String,
    pub contract_address: String,
    pub abi: serde_json::Value,
    pub virtual_eth_amount: f64,
    pub virtual_token_amount: f64,
    pub total_supply: f64,
    pub target_market_cap: f64,
    pub pools: Vec<String>,
}

fn load_abi() -> serde_json::Value {
    let abi_str = include_str!("FyuzV1.json");
    serde_json::from_str(abi_str).expect("Failed to parse FyuzV1.json ABI")
}

pub fn default_chains() -> Vec<ChainConfig> {
    let abi = load_abi();

    vec![
        ChainConfig {
            name: "BNB Smart Chain".to_string(),
            network: "bsc".to_string(),
            chain_id: std::env::var("CHAIN_ID")
                .or_else(|_| std::env::var("BSC_CHAIN_ID"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(56),
            currency: "BNB".to_string(),
            rpc_url: std::env::var("BSC_PUBLIC_RPC_URL")
                .or_else(|_| std::env::var("BSC_RPC_URL"))
                .or_else(|_| std::env::var("ETH_PUBLIC_RPC_URL"))
                .or_else(|_| std::env::var("ETH_RPC_URL"))
                .unwrap_or_else(|_| "https://bsc-dataseed.bnbchain.org".to_string()),
            ws_url: Some(
                std::env::var("BSC_WS_URL")
                    .or_else(|_| std::env::var("ETH_WS_URL"))
                    .unwrap_or_else(|_| "wss://bsc-ws-node.nariox.org".to_string()),
            ),
            explorer_url: std::env::var("BSC_EXPLORER_URL")
                .unwrap_or_else(|_| "https://bscscan.com".to_string()),
            // The money-critical indexer reads events from THIS address; a wrong
            // one silently indexes nothing (or the wrong contract). Fail closed —
            // require FYUZ_CONTRACT_ADDRESS rather than defaulting to a stale
            // anvil-fork address, matching how API_KEY/DATABASE_URL fail closed.
            // localnet.sh always sets it after deploy.
            contract_address: std::env::var("FYUZ_CONTRACT_ADDRESS")
                .expect("FYUZ_CONTRACT_ADDRESS must be set (the Fyuz proxy address the indexer reads)"),
            abi,
            // These MIRROR the on-chain constants in foundry/src/Fyuz.sol and must
            // be kept in step with them — the frontend prices the curve off these.
            //
            // virtual_eth_amount is denominated in the chain's NATIVE token, which
            // on BSC is BNB (~$575), not ETH. The ETH-era 2.5 opened at only ~$1.3K
            // on BNB and capped the curve under the graduation target, so no token
            // could ever graduate. 8.25 BNB restores the ETH design's ~$4.4K opening.
            virtual_eth_amount: 8.25, // == VIRTUAL_ETH_INITIAL
            virtual_token_amount: 1_073_000_000.0, // == VIRTUAL_TOKEN_INITIAL
            total_supply: 1_000_000_000.0, // == TOTAL_SUPPLY
            target_market_cap: 30_000.0, // == TARGET_MARKET_CAP_USD
            // Index is load-bearing: the frontend resolves a token's pool via
            // `chain.pools[token.poolType - 1]`, and the on-chain enum is
            // 1 = V2, 2 = V3, 3 = V4. So V2 MUST stay at index 0 and V3 at index 1.
            // V4 ("pancakeswap:v4") and direct launch ("direct:v4") are gated off by
            // omission here — the contract code stays dormant, not removed.
            pools: vec![
                "pancakeswap:v2".to_string(),
                "pancakeswap:v3".to_string(),
            ],
        },
    ]
}
