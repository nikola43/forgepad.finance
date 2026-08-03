//! Service metadata: liveness and chain configuration.

use serde::Deserialize;

/// Response of `GET /health`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthStatus {
    /// `"ok"` when the API is serving.
    pub status: String,
}

/// One chain the Fyuz deployment is configured for.
///
/// The live service returns additional operational fields (RPC URL, explorer
/// URL, contract address); only the two documented in the OpenAPI contract are
/// modelled here. Unknown fields are ignored rather than rejected, so this stays
/// forward compatible.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainInfo {
    /// Human-readable chain name, e.g. `"BNB Smart Chain"`.
    pub name: String,
    /// EVM chain id, e.g. `56` for BNB Smart Chain mainnet.
    pub chain_id: i64,
    /// Chain slug used everywhere else in the API, e.g. `"bsc"`.
    #[serde(default)]
    pub network: Option<String>,
    /// The Fyuz launchpad on this chain — the `to` of every swap.
    ///
    /// Read from here rather than hardcoded anywhere in this crate: it sits
    /// behind an upgradeable proxy, and a new chain should not need a release.
    #[serde(default)]
    pub contract_address: Option<String>,
    /// A JSON-RPC endpoint, as configured by the API operator.
    ///
    /// Treat it as a default, not an entitlement: it is shared by every caller
    /// and can change without notice. Set your own with
    /// [`FyuzClientBuilder::rpc_url`](crate::FyuzClientBuilder::rpc_url) for
    /// anything in production.
    #[serde(default)]
    pub rpc_url: Option<String>,
    /// WebSocket sibling of [`ChainInfo::rpc_url`].
    #[serde(default)]
    pub ws_url: Option<String>,
    /// Native gas currency symbol, e.g. `"BNB"`.
    #[serde(default)]
    pub currency: Option<String>,
    /// Block explorer root, e.g. `"https://bscscan.com"`.
    #[serde(default)]
    pub explorer_url: Option<String>,
    /// DEX venues a graduated token can end up on.
    #[serde(default)]
    pub pools: Vec<String>,
    /// USD market cap at which a token graduates off the curve.
    #[serde(default)]
    pub target_market_cap: Option<f64>,
    /// Tokens minted per launch.
    #[serde(default)]
    pub total_supply: Option<f64>,
    /// Virtual native reserve a new curve starts with.
    #[serde(default)]
    pub virtual_eth_amount: Option<f64>,
    /// Virtual token reserve a new curve starts with.
    #[serde(default)]
    pub virtual_token_amount: Option<f64>,
    /// First block the indexer reads.
    #[serde(default)]
    pub start_block: Option<i64>,
}

/// Response of `GET /config`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    /// Chains this deployment serves. Currently a single entry, `bsc`.
    pub chains: Vec<ChainInfo>,
}
