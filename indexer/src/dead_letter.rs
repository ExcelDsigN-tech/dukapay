//! Durable NDJSON storage for events that exhaust their processing retries.

use crate::rpc::RawEvent;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::Arc;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

#[derive(Deserialize, Serialize)]
struct DeadLetterRecord {
    event_id: String,
    contract_id: String,
    ledger: u32,
    attempts: u32,
    error: String,
    event: RawEvent,
}

#[derive(Clone)]
pub struct DeadLetterQueue {
    path: String,
    recorded_events: Arc<Mutex<HashSet<String>>>,
}

impl DeadLetterQueue {
    pub async fn new(path: impl Into<String>) -> Result<Self> {
        let path = path.into();
        let mut recorded_events = HashSet::new();
        match tokio::fs::read(&path).await {
            Ok(contents) => {
                for line in contents.split(|byte| *byte == b'\n') {
                    if let Ok(record) = serde_json::from_slice::<DeadLetterRecord>(line) {
                        recorded_events.insert(event_key(&record.contract_id, &record.event_id));
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }

        Ok(Self {
            path,
            recorded_events: Arc::new(Mutex::new(recorded_events)),
        })
    }

    pub async fn push(&self, event: &RawEvent, error: &str, attempts: u32) -> Result<bool> {
        let key = event_key(&event.contract_id, &event.id);
        let mut recorded_events = self.recorded_events.lock().await;
        if recorded_events.contains(&key) {
            return Ok(false);
        }

        let record = DeadLetterRecord {
            event_id: event.id.clone(),
            contract_id: event.contract_id.clone(),
            ledger: event.ledger,
            attempts,
            error: error.to_string(),
            event: event.clone(),
        };
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        file.write_all(&serde_json::to_vec(&record)?).await?;
        file.write_all(b"\n").await?;
        file.sync_all().await?;
        recorded_events.insert(key);
        Ok(true)
    }
}

fn event_key(contract_id: &str, event_id: &str) -> String {
    format!("{contract_id}:{event_id}")
}
