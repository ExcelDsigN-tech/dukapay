//! Runtime configuration, loaded entirely from environment variables so the
//! indexer can be deployed as a stateless, horizontally scalable service.

use anyhow::{Context, Result};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct Config {
    /// Soroban-RPC endpoint (e.g. https://soroban-testnet.stellar.org).
    pub rpc_url: String,
    /// Contract IDs to index. At least one is required.
    pub contract_ids: Vec<String>,
    /// Number of ledgers to stay behind the tip before treating events as final.
    pub finality_depth: u32,
    /// How often to poll the RPC for new events.
    pub poll_interval: Duration,
    /// Max ledgers requested per `getEvents` page.
    pub batch_size: u32,
    /// Number of parallel workers draining the event channel.
    pub worker_concurrency: usize,
    /// Bounded channel capacity between the fetcher and the workers.
    pub channel_capacity: usize,
    /// Optional shard config for horizontal scaling: (shard_index, shard_total).
    /// A contract is processed by shard `crc(contract_id) % shard_total`.
    pub shard: (u32, u32),
    /// Where checkpoints are persisted.
    pub checkpoint: CheckpointBackend,
    /// Where decoded events are emitted.
    pub sink: SinkBackend,
    /// Port for the Prometheus `/metrics` + `/healthz` server.
    pub metrics_port: u16,
    /// Alert threshold (in ledgers) used only to flip the `indexer_lag_ok` gauge.
    pub lag_alert_threshold: i64,
}

#[derive(Clone, Debug)]
pub enum CheckpointBackend {
    /// JSON file on a persistent volume — fine for single-replica deployments.
    File { path: String },
    /// Postgres row per (shard, contract) — required for multi-replica.
    Postgres { url: String },
}

#[derive(Clone, Debug)]
pub enum SinkBackend {
    Stdout,
    /// Newline-delimited JSON appended to a file.
    File {
        path: String,
    },
    /// Kafka topic (requires the `kafka` cargo feature).
    Kafka {
        #[cfg_attr(not(feature = "kafka"), allow(dead_code))]
        brokers: String,
        #[cfg_attr(not(feature = "kafka"), allow(dead_code))]
        topic: String,
    },
}

fn env(key: &str) -> Option<String> {
    std::env::var(key).ok().filter(|v| !v.trim().is_empty())
}

fn env_or(key: &str, default: &str) -> String {
    env(key).unwrap_or_else(|| default.to_string())
}

fn parse<T: std::str::FromStr>(key: &str, default: T) -> Result<T>
where
    T::Err: std::fmt::Display,
{
    match env(key) {
        None => Ok(default),
        Some(raw) => raw
            .parse::<T>()
            .map_err(|e| anyhow::anyhow!("invalid {key}: {e}")),
    }
}

impl Config {
    pub fn from_env() -> Result<Self> {
        let rpc_url = env("INDEXER_RPC_URL")
            .or_else(|| env("STELLAR_RPC_URL"))
            .context("INDEXER_RPC_URL (or STELLAR_RPC_URL) is required")?;

        let contract_ids: Vec<String> = env("INDEXER_CONTRACT_IDS")
            .context("INDEXER_CONTRACT_IDS is required (comma-separated)")?
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        anyhow::ensure!(!contract_ids.is_empty(), "INDEXER_CONTRACT_IDS is empty");

        // Accepts a plain integer, or a StatefulSet pod name like
        // "dukapay-indexer-2" from which the trailing ordinal is extracted.
        let shard_index: u32 = match env("INDEXER_SHARD_INDEX") {
            None => 0,
            Some(raw) => raw
                .parse::<u32>()
                .or_else(|_| raw.rsplit('-').next().unwrap_or("").parse::<u32>())
                .context(
                    "INDEXER_SHARD_INDEX must be an integer or pod name ending in -<ordinal>",
                )?,
        };
        let shard_total: u32 = parse("INDEXER_SHARD_TOTAL", 1)?;
        anyhow::ensure!(shard_total >= 1, "INDEXER_SHARD_TOTAL must be >= 1");
        anyhow::ensure!(
            shard_index < shard_total,
            "INDEXER_SHARD_INDEX must be < INDEXER_SHARD_TOTAL"
        );

        let checkpoint = match env("INDEXER_CHECKPOINT_DSN").or_else(|| env("DATABASE_URL")) {
            Some(url) => CheckpointBackend::Postgres { url },
            None => CheckpointBackend::File {
                path: env_or("INDEXER_CHECKPOINT_FILE", "./checkpoints.json"),
            },
        };

        let sink = match env_or("INDEXER_SINK", "stdout").as_str() {
            "stdout" => SinkBackend::Stdout,
            "file" => SinkBackend::File {
                path: env_or("INDEXER_SINK_FILE", "./events.ndjson"),
            },
            "kafka" => SinkBackend::Kafka {
                brokers: env("INDEXER_KAFKA_BROKERS").context("INDEXER_KAFKA_BROKERS required")?,
                topic: env_or("INDEXER_KAFKA_TOPIC", "dukapay.contract-events"),
            },
            other => anyhow::bail!("unknown INDEXER_SINK: {other}"),
        };

        Ok(Self {
            rpc_url,
            contract_ids,
            finality_depth: parse("INDEXER_FINALITY_DEPTH", 5)?,
            poll_interval: Duration::from_millis(parse("INDEXER_POLL_INTERVAL_MS", 3000u64)?),
            batch_size: parse("INDEXER_BATCH_SIZE", 200)?,
            worker_concurrency: parse("INDEXER_WORKER_CONCURRENCY", 8usize)?,
            channel_capacity: parse("INDEXER_CHANNEL_CAPACITY", 10_000usize)?,
            shard: (shard_index, shard_total),
            checkpoint,
            sink,
            metrics_port: parse("INDEXER_METRICS_PORT", 9464u16)?,
            lag_alert_threshold: parse("INDEXER_LAG_ALERT_THRESHOLD", 100i64)?,
        })
    }

    /// Deterministic shard assignment for a contract ID.
    pub fn owns_contract(&self, contract_id: &str) -> bool {
        let (idx, total) = self.shard;
        if total == 1 {
            return true;
        }
        let crc = contract_id
            .bytes()
            .fold(0u32, |acc, b| acc.wrapping_mul(31).wrapping_add(b as u32));
        crc % total == idx
    }

    /// Contract IDs this replica is responsible for.
    pub fn owned_contracts(&self) -> Vec<String> {
        self.contract_ids
            .iter()
            .filter(|c| self.owns_contract(c))
            .cloned()
            .collect()
    }
}
