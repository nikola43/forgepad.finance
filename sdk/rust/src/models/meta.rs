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
}

/// Response of `GET /config`.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChainConfig {
    /// Chains this deployment serves. Currently a single entry, `bsc`.
    pub chains: Vec<ChainInfo>,
}
