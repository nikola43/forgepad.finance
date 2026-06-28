pub mod config;
pub mod errors;
pub mod handlers;
pub mod middleware;
pub mod models;
pub mod routes;
pub mod schema;
pub mod services;

use aws_sdk_s3::config::{Credentials, Region};
use aws_config::BehaviorVersion;
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
    pub s3_client: Option<aws_sdk_s3::Client>,
    pub s3_bucket: String,
    pub s3_public_url: String,
}

impl AppState {
    pub async fn new(
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

        std::fs::create_dir_all(&upload_dir).ok();

        let s3_client = if let Ok(endpoint) = std::env::var("S3_ENDPOINT") {
            let access_key = std::env::var("S3_ACCESS_KEY").unwrap_or_else(|_| "minioadmin".into());
            let secret_key = std::env::var("S3_SECRET_KEY").unwrap_or_else(|_| "minioadmin".into());
            let region = std::env::var("S3_REGION").unwrap_or_else(|_| "us-east-1".into());
            let creds = Credentials::new(access_key, secret_key, None, None, "minio");
            let base = aws_config::defaults(BehaviorVersion::latest())
                .region(Region::new(region))
                .endpoint_url(&endpoint)
                .credentials_provider(creds)
                .load()
                .await;
            let s3_config = aws_sdk_s3::config::Builder::from(&base)
                .force_path_style(true)
                .build();
            Some(aws_sdk_s3::Client::from_conf(s3_config))
        } else {
            None
        };

        let s3_bucket = std::env::var("S3_BUCKET").unwrap_or_else(|_| "forgepad".into());
        let s3_public_url = std::env::var("S3_PUBLIC_URL")
            .unwrap_or_else(|_| "http://localhost:9000/forgepad".into());

        Arc::new(Self {
            db,
            redis,
            ws_tx,
            ws_subs: DashMap::new(),
            chains,
            api_key,
            upload_dir,
            upload_base_url,
            s3_client,
            s3_bucket,
            s3_public_url,
        })
    }
}
