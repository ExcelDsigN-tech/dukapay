//! Output sinks for decoded events. Downstream consumers (the TypeScript backend,
//! analytics, alerting) read from here instead of hammering the RPC directly.

use crate::config::SinkBackend;
use anyhow::Result;
use serde::Serialize;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

/// Normalised event shape written to the sink. Intentionally close to the
/// TypeScript `SorobanRawEvent` so the existing backend consumer needs no
/// remapping.
#[derive(Debug, Clone, Serialize)]
pub struct DecodedEvent {
    pub id: String,
    pub paging_token: String,
    pub contract_id: String,
    pub event_type: String,
    pub ledger: u32,
    pub ledger_closed_at: String,
    pub tx_hash: String,
    pub topics: Vec<String>,
    pub value: serde_json::Value,
    /// Shard that produced this event — lets consumers dedupe across replicas.
    pub shard: u32,
}

#[derive(Clone)]
pub enum Sink {
    Stdout,
    File(Arc<Mutex<tokio::fs::File>>),
    #[cfg(feature = "kafka")]
    Kafka {
        producer: Arc<rdkafka::producer::FutureProducer>,
        topic: String,
    },
}

impl Sink {
    pub async fn connect(backend: &SinkBackend) -> Result<Self> {
        match backend {
            SinkBackend::Stdout => Ok(Sink::Stdout),
            SinkBackend::File { path } => {
                let f = tokio::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(path)
                    .await?;
                Ok(Sink::File(Arc::new(Mutex::new(f))))
            }
            #[cfg(feature = "kafka")]
            SinkBackend::Kafka { brokers, topic } => {
                use rdkafka::config::ClientConfig;
                let producer = ClientConfig::new()
                    .set("bootstrap.servers", brokers)
                    .set("message.timeout.ms", "10000")
                    .set("compression.type", "lz4")
                    .set("enable.idempotence", "true")
                    .create()?;
                Ok(Sink::Kafka {
                    producer: Arc::new(producer),
                    topic: topic.clone(),
                })
            }
            #[cfg(not(feature = "kafka"))]
            SinkBackend::Kafka { .. } => {
                anyhow::bail!("kafka sink requested but binary built without the `kafka` feature")
            }
        }
    }

    pub async fn emit(&self, event: &DecodedEvent) -> Result<()> {
        let line = serde_json::to_string(event)?;
        match self {
            Sink::Stdout => {
                let mut out = tokio::io::stdout();
                out.write_all(line.as_bytes()).await?;
                out.write_all(b"\n").await?;
            }
            Sink::File(f) => {
                let mut f = f.lock().await;
                f.write_all(line.as_bytes()).await?;
                f.write_all(b"\n").await?;
            }
            #[cfg(feature = "kafka")]
            Sink::Kafka { producer, topic } => {
                use rdkafka::producer::FutureRecord;
                let key = event.contract_id.clone();
                producer
                    .send(
                        FutureRecord::to(topic).key(&key).payload(&line),
                        std::time::Duration::from_secs(10),
                    )
                    .await
                    .map_err(|(e, _)| anyhow::anyhow!("kafka send: {e}"))?;
            }
        }
        Ok(())
    }
}
