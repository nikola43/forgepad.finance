pub mod config;
pub mod errors;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod schema;
pub mod services;

use config::chains::ChainConfig;
use config::database::DbPool;
use dashmap::DashMap;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::broadcast;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WsEvent {
    Trade {
        token_address: String,
        date: i64,
        token_price: String,
        volume: String,
    },
    Deployed {
        token: serde_json::Value,
    },
}

use serde::{Deserialize, Serialize};

pub struct AppState {
    pub db: DbPool,
    pub redis: redis::Client,
    pub ws_tx: broadcast::Sender<WsEvent>,
    pub ws_subs: DashMap<String, HashSet<u64>>,
    pub chains: Vec<ChainConfig>,
    pub api_key: String,
    pub upload_dir: String,
    pub upload_base_url: String,
}

impl AppState {
    pub fn new(
        db: DbPool,
        redis: redis::Client,
        chains: Vec<ChainConfig>,
        api_key: String,
    ) -> Arc<Self> {
        let (ws_tx, _) = broadcast::channel(1024);
        let upload_dir = std::env::var("UPLOAD_DIR")
            .unwrap_or_else(|_| "./uploads".to_string());
        let upload_base_url = std::env::var("UPLOAD_BASE_URL")
            .unwrap_or_else(|_| "http://localhost:5001/uploads".to_string());

        // Ensure upload directory exists
        std::fs::create_dir_all(&upload_dir).ok();

        Arc::new(Self {
            db,
            redis,
            ws_tx,
            ws_subs: DashMap::new(),
            chains,
            api_key,
            upload_dir,
            upload_base_url,
        })
    }
}
