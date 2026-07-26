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
    // Serialized to the frontend via /config; the create/token pages build
    // ethers Contracts from chain.abi. skip_deserializing keeps abi optional on
    // input (nothing deserializes a ChainConfig back in) while still emitting it.
    #[serde(skip_deserializing)]
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

#[derive(Deserialize)]
struct ConfigFile {
    chains: Vec<ChainEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ChainEntry {
    name: String,
    network: String,
    chain_id: u64,
    currency: String,
    rpc_url: String,
    ws_url: Option<String>,
    explorer_url: String,
    contract_address: String,
    virtual_eth_amount: f64,
    virtual_token_amount: f64,
    total_supply: f64,
    target_market_cap: f64,
    pools: Vec<String>,
}

pub fn default_chains() -> Vec<ChainConfig> {
    let abi = load_abi();

    // Try loading from config.json next to the Cargo.toml (or in CWD).
    let config_path = std::env::var("CHAINS_CONFIG")
        .unwrap_or_else(|_| "config.json".to_string());

    let config_str = match std::fs::read_to_string(&config_path) {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!("Failed to read {config_path}: {e}; falling back to single-chain env config");
            return fallback_env_chains(abi);
        }
    };

    let config: ConfigFile = match serde_json::from_str(&config_str) {
        Ok(c) => c,
        Err(e) => {
            tracing::warn!("Failed to parse {config_path}: {e}; falling back to single-chain env config");
            return fallback_env_chains(abi);
        }
    };

    config
        .chains
        .into_iter()
        .map(|entry| apply_env_overrides(entry, &abi))
        .collect()
}

/// Apply per-chain env var overrides. The naming convention is
/// `<NETWORK>_CONTRACT_ADDRESS`, `<NETWORK>_RPC_URL`, etc. This lets each
/// chain's critical address be overridden from .env without editing config.json.
fn apply_env_overrides(entry: ChainEntry, abi: &serde_json::Value) -> ChainConfig {
    let net = entry.network.to_uppercase();

    let contract_address = std::env::var(format!("{net}_CONTRACT_ADDRESS"))
        .unwrap_or(entry.contract_address);

    let rpc_url = std::env::var(format!("{net}_RPC_URL"))
        .or_else(|_| std::env::var("ETH_RPC_URL".to_string()))
        .unwrap_or(entry.rpc_url);

    let ws_url = std::env::var(format!("{net}_WS_URL"))
        .ok()
        .filter(|s| !s.is_empty())
        .or(entry.ws_url);

    let explorer_url = std::env::var(format!("{net}_EXPLORER_URL"))
        .unwrap_or(entry.explorer_url);

    ChainConfig {
        name: entry.name,
        network: entry.network,
        chain_id: entry.chain_id,
        currency: entry.currency,
        rpc_url,
        ws_url,
        explorer_url,
        contract_address,
        abi: abi.clone(),
        virtual_eth_amount: entry.virtual_eth_amount,
        virtual_token_amount: entry.virtual_token_amount,
        total_supply: entry.total_supply,
        target_market_cap: entry.target_market_cap,
        pools: entry.pools,
    }
}

/// Legacy single-chain fallback when config.json is missing. Reads the same env
/// vars the old code used, so existing .env files keep working.
fn fallback_env_chains(abi: serde_json::Value) -> Vec<ChainConfig> {
    vec![ChainConfig {
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
        contract_address: std::env::var("FYUZ_CONTRACT_ADDRESS")
            .expect("FYUZ_CONTRACT_ADDRESS must be set"),
        abi,
        virtual_eth_amount: 8.25,
        virtual_token_amount: 1_073_000_000.0,
        total_supply: 1_000_000_000.0,
        target_market_cap: 30_000.0,
        pools: vec![
            "pancakeswap:v2".to_string(),
            "pancakeswap:v3".to_string(),
        ],
    }]
}
