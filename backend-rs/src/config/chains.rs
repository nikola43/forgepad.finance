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
    let abi_str = include_str!("ForgepadV1.json");
    serde_json::from_str(abi_str).expect("Failed to parse ForgepadV1.json ABI")
}

pub fn default_chains() -> Vec<ChainConfig> {
    let abi = load_abi();

    vec![ChainConfig {
        name: "Ethereum".to_string(),
        network: "mainnet".to_string(),
        chain_id: std::env::var("CHAIN_ID")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(1),
        currency: "ETH".to_string(),
        rpc_url: std::env::var("ETH_PUBLIC_RPC_URL")
            .or_else(|_| std::env::var("ETH_RPC_URL"))
            .unwrap_or_else(|_| "http://127.0.0.1:8545".to_string()),
        ws_url: Some(std::env::var("ETH_WS_URL")
            .unwrap_or_else(|_| "ws://127.0.0.1:8545".to_string())),
        explorer_url: "https://etherscan.io".to_string(),
        contract_address: "0x9b9535f3bc5F3Fe1D525a0dc372eF4cC29d7a86d".to_string(),
        abi,
        virtual_eth_amount: 2.5,
        virtual_token_amount: 1_073_000_000.0,
        total_supply: 1_000_000_000.0,
        target_market_cap: 69_000.0,
        pools: vec!["uniswap:v2".to_string()],
    }]
}
