use diesel_async::pooled_connection::deadpool::Pool;
use diesel_async::pooled_connection::{AsyncDieselConnectionManager, ManagerConfig};
use diesel_async::AsyncPgConnection;
use futures::FutureExt;

pub type DbPool = Pool<AsyncPgConnection>;

pub fn create_pool(database_url: &str) -> DbPool {
    if database_url.contains("sslmode=require") {
        create_tls_pool(database_url)
    } else {
        create_simple_pool(database_url)
    }
}

/// Simple pool for local/Docker PostgreSQL (no TLS)
fn create_simple_pool(database_url: &str) -> DbPool {
    let config = AsyncDieselConnectionManager::<AsyncPgConnection>::new(database_url);
    Pool::builder(config)
        .max_size(10)
        .build()
        .expect("Failed to create database pool")
}

/// TLS pool for remote databases (Supabase, etc.)
fn create_tls_pool(database_url: &str) -> DbPool {
    let mut config = ManagerConfig::default();
    config.custom_setup = Box::new(establish_tls_connection);

    let manager =
        AsyncDieselConnectionManager::<AsyncPgConnection>::new_with_config(database_url, config);
    Pool::builder(manager)
        .max_size(10)
        .build()
        .expect("Failed to create database pool")
}

fn establish_tls_connection(
    url: &str,
) -> futures::future::BoxFuture<'_, diesel::ConnectionResult<AsyncPgConnection>> {
    let url = url.to_string();
    async move {
        let mut builder = openssl::ssl::SslConnector::builder(openssl::ssl::SslMethod::tls())
            .map_err(|e| diesel::ConnectionError::BadConnection(e.to_string()))?;
        // Verify the server certificate against the system's default CA roots.
        builder
            .set_default_verify_paths()
            .map_err(|e| diesel::ConnectionError::BadConnection(e.to_string()))?;
        builder.set_verify(openssl::ssl::SslVerifyMode::PEER);
        let tls = postgres_openssl::MakeTlsConnector::new(builder.build());

        let (client, connection) = tokio_postgres::connect(&url, tls)
            .await
            .map_err(|e| diesel::ConnectionError::BadConnection(e.to_string()))?;

        AsyncPgConnection::try_from_client_and_connection(client, connection).await
    }
    .boxed()
}
