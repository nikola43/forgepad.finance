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
    let abi_str = include_str!("ArrowpadV1.json");
    serde_json::from_str(abi_str).expect("Failed to parse ArrowpadV1.json ABI")
}

pub fn default_chains() -> Vec<ChainConfig> {
    let abi = load_abi();

    vec![
        ChainConfig {
            name: "Robinhood".to_string(),
            network: "robinhood".to_string(),
            chain_id: std::env::var("CHAIN_ID")
                .or_else(|_| std::env::var("ROBINHOOD_CHAIN_ID"))
                .ok()
                .and_then(|v| v.parse().ok())
                .unwrap_or(4663),
            currency: "ETH".to_string(),
            rpc_url: std::env::var("ROBINHOOD_PUBLIC_RPC_URL")
                .or_else(|_| std::env::var("ROBINHOOD_RPC_URL"))
                .or_else(|_| std::env::var("ETH_PUBLIC_RPC_URL"))
                .or_else(|_| std::env::var("ETH_RPC_URL"))
                .unwrap_or_else(|_| "https://rpc.mainnet.chain.robinhood.com".to_string()),
            ws_url: Some(
                std::env::var("ROBINHOOD_WS_URL")
                    .or_else(|_| std::env::var("ETH_WS_URL"))
                    .unwrap_or_else(|_| "wss://rpc.mainnet.chain.robinhood.com".to_string()),
            ),
            explorer_url: std::env::var("ROBINHOOD_EXPLORER_URL")
                .unwrap_or_else(|_| "https://explorer.mainnet.chain.robinhood.com".to_string()),
            contract_address: "0x7faDE3d4Ed92661Ad16437f6774E107785286189".to_string(),
            abi,
            virtual_eth_amount: 2.5,
            virtual_token_amount: 1_073_000_000.0,
            total_supply: 1_000_000_000.0,
            target_market_cap: 20_000.0,
            pools: vec![
                "uniswap:v2".to_string(),
                "uniswap:v3".to_string(),
                "uniswap:v4".to_string(),
            ],
        },
    ]
}
