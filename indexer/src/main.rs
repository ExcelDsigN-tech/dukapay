//! DukaPay standalone Soroban event indexer.
//!
//! Replaces the in-process TypeScript indexer for mainnet throughput:
//!   * parallel fetch (one task per contract) + parallel decode (worker pool)
//!   * durable checkpointing (file or Postgres) for at-least-once delivery
//!   * horizontal scaling via deterministic contract sharding
//!   * Prometheus health metrics (lag, throughput, error rate) on `/metrics`
//!
//! Configuration is entirely environment-driven — see `README.md`.

mod checkpoint;
mod config;
mod metrics;
mod pipeline;
mod rpc;
mod sink;

use anyhow::Result;
use tracing_subscriber::{prelude::*, EnvFilter};

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();

    let cfg = config::Config::from_env()?;
    tracing::info!(
        rpc = %cfg.rpc_url,
        contracts = cfg.contract_ids.len(),
        shard = format!("{}/{}", cfg.shard.0, cfg.shard.1),
        workers = cfg.worker_concurrency,
        "booting dukapay-indexer"
    );

    let metrics_port = cfg.metrics_port;
    let metrics_task = tokio::spawn(async move {
        if let Err(e) = metrics::serve(metrics_port).await {
            tracing::error!(error = %e, "metrics server crashed");
        }
    });

    tokio::select! {
        res = pipeline::run(cfg) => {
            if let Err(e) = &res {
                tracing::error!(error = %e, "pipeline exited with error");
            }
            res?;
        }
        _ = tokio::signal::ctrl_c() => {
            tracing::info!("SIGINT received, shutting down");
        }
    }

    metrics_task.abort();
    Ok(())
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("INDEXER_LOG")
        .or_else(|_| EnvFilter::try_new("info"))
        .unwrap();
    let json = std::env::var("INDEXER_LOG_FORMAT").as_deref() == Ok("json");
    let registry = tracing_subscriber::registry().with(filter);
    if json {
        registry
            .with(tracing_subscriber::fmt::layer().json())
            .init();
    } else {
        registry.with(tracing_subscriber::fmt::layer()).init();
    }
}
