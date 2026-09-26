//! The core indexing loop: one fetcher task per owned contract pushes finalised
//! events into a bounded channel; a pool of workers decodes and emits them in
//! parallel; checkpoints advance only after the whole batch for a ledger range
//! has been drained.

use crate::checkpoint::AnyCheckpointStore;
use crate::config::Config;
use crate::dead_letter::DeadLetterQueue;
use crate::metrics;
use crate::rpc::{RawEvent, SorobanRpc};
use crate::sink::{DecodedEvent, Sink};
use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc;

struct Batch {
    contract_id: String,
    /// Exclusive upper bound processed once every event here is emitted.
    through_ledger: u32,
    events: Vec<RawEvent>,
    done: tokio::sync::oneshot::Sender<bool>,
}

pub async fn run(cfg: Config) -> Result<()> {
    let cfg = Arc::new(cfg);
    let rpc = SorobanRpc::new(cfg.rpc_url.clone());
    let sink = Sink::connect(&cfg.sink).await?;
    let checkpoints = build_checkpoint_store(&cfg).await?;
    let dead_letters = DeadLetterQueue::new(cfg.dead_letter_file.clone()).await?;

    let owned = cfg.owned_contracts();
    anyhow::ensure!(
        !owned.is_empty(),
        "shard {}/{} owns no contracts",
        cfg.shard.0,
        cfg.shard.1
    );
    tracing::info!(?owned, shard = cfg.shard.0, "starting indexer");

    let (tx, rx) = mpsc::channel::<Batch>(cfg.channel_capacity);
    let rx = Arc::new(tokio::sync::Mutex::new(rx));

    // Worker pool.
    let mut workers = Vec::new();
    for id in 0..cfg.worker_concurrency {
        let rx = rx.clone();
        let sink = sink.clone();
        let checkpoints = checkpoints.clone();
        let dead_letters = dead_letters.clone();
        let cfg = cfg.clone();
        workers.push(tokio::spawn(async move {
            worker_loop(id, rx, sink, checkpoints, dead_letters, cfg).await
        }));
    }

    // One fetcher per contract.
    let mut fetchers = Vec::new();
    for contract in owned {
        let rpc = rpc.clone();
        let tx = tx.clone();
        let cfg = cfg.clone();
        let checkpoints = checkpoints.clone();
        fetchers.push(tokio::spawn(async move {
            fetcher_loop(contract, rpc, tx, cfg, checkpoints).await
        }));
    }
    drop(tx);

    metrics::set_ready(true);

    // If any fetcher exits it is fatal — let the process restart under the orchestrator.
    for f in fetchers {
        f.await??;
    }
    for w in workers {
        w.await??;
    }
    Ok(())
}

async fn build_checkpoint_store(cfg: &Config) -> Result<AnyCheckpointStore> {
    use crate::checkpoint::FileCheckpointStore;
    use crate::config::CheckpointBackend;
    match &cfg.checkpoint {
        CheckpointBackend::File { path } => Ok(AnyCheckpointStore::File(
            FileCheckpointStore::new(path.clone()).await?,
        )),
        #[cfg(feature = "postgres")]
        CheckpointBackend::Postgres { url } => Ok(AnyCheckpointStore::Pg(
            crate::checkpoint::PgCheckpointStore::new(url).await?,
        )),
        #[cfg(not(feature = "postgres"))]
        CheckpointBackend::Postgres { .. } => {
            anyhow::bail!(
                "postgres checkpoint requested but binary built without `postgres` feature"
            )
        }
    }
}

async fn fetcher_loop(
    contract: String,
    rpc: SorobanRpc,
    tx: mpsc::Sender<Batch>,
    cfg: Arc<Config>,
    checkpoints: AnyCheckpointStore,
) -> Result<()> {
    let shard = cfg.shard.0;
    let mut next_ledger = match checkpoints.load(shard, &contract).await? {
        Some(cp) => cp + 1,
        None => rpc
            .latest_ledger()
            .await?
            .saturating_sub(cfg.finality_depth),
    };
    tracing::info!(%contract, next_ledger, "fetcher resuming");

    loop {
        let tip = match rpc.latest_ledger().await {
            Ok(t) => t,
            Err(e) => {
                metrics::FETCH_ERRORS.inc();
                tracing::warn!(%contract, error = %e, "latest_ledger failed");
                tokio::time::sleep(cfg.poll_interval).await;
                continue;
            }
        };
        let safe_tip = tip.saturating_sub(cfg.finality_depth);
        let lag = safe_tip as i64 - next_ledger as i64;
        metrics::LEDGER_LAG
            .with_label_values(&[&contract])
            .set(lag.max(0));
        metrics::LAG_OK.set(if lag <= cfg.lag_alert_threshold { 1 } else { 0 });

        if next_ledger > safe_tip {
            tokio::time::sleep(cfg.poll_interval).await;
            continue;
        }

        // Page through getEvents for [next_ledger, safe_tip], respecting the
        // RPC's own ledger-span cap by starting at next_ledger and following
        // the cursor until we pass safe_tip or run out.
        let mut cursor: Option<String> = None;
        let mut collected: Vec<RawEvent> = Vec::new();
        let mut through = next_ledger;
        let mut fetch_failed = false;
        loop {
            let page = match rpc
                .get_events(
                    next_ledger,
                    std::slice::from_ref(&contract),
                    cursor.as_deref(),
                    cfg.batch_size,
                )
                .await
            {
                Ok(p) => p,
                Err(e) => {
                    metrics::FETCH_ERRORS.inc();
                    tracing::warn!(%contract, error = %e, "get_events failed");
                    fetch_failed = true;
                    break;
                }
            };
            let page_cursor = page.cursor.clone();
            let empty = page.events.is_empty();
            for ev in page.events {
                if ev.ledger <= safe_tip {
                    through = through.max(ev.ledger);
                    collected.push(ev);
                }
            }
            match page_cursor {
                Some(c) if !empty && collected.len() < cfg.batch_size as usize * 4 => {
                    cursor = Some(c);
                }
                _ => break,
            }
        }

        if fetch_failed {
            tokio::time::sleep(cfg.poll_interval).await;
            continue;
        }

        // Advance at least to safe_tip even when there were no events, so we
        // don't re-scan quiet ledger ranges forever.
        through = through.max(safe_tip);

        let (done_tx, done_rx) = tokio::sync::oneshot::channel();
        if tx
            .send(Batch {
                contract_id: contract.clone(),
                through_ledger: through,
                events: collected,
                done: done_tx,
            })
            .await
            .is_err()
        {
            anyhow::bail!("worker channel closed");
        }
        // Backpressure: wait for the batch to be fully processed + checkpointed
        // before fetching the next range. Keeps at-least-once semantics simple.
        match done_rx.await {
            Ok(true) => next_ledger = through + 1,
            Ok(false) => tokio::time::sleep(cfg.poll_interval).await,
            Err(_) => anyhow::bail!("worker acknowledgement channel closed"),
        }
    }
}

async fn worker_loop(
    id: usize,
    rx: Arc<tokio::sync::Mutex<mpsc::Receiver<Batch>>>,
    sink: Sink,
    checkpoints: AnyCheckpointStore,
    dead_letters: DeadLetterQueue,
    cfg: Arc<Config>,
) -> Result<()> {
    loop {
        let batch = {
            let mut guard = rx.lock().await;
            match guard.recv().await {
                Some(b) => b,
                None => return Ok(()),
            }
        };
        let n = batch.events.len();
        let mut batch_failed = false;
        for raw in &batch.events {
            let mut emitted = false;
            let mut last_error = String::new();
            for attempt in 0..=cfg.max_event_retries {
                match decode(raw, cfg.shard.0) {
                    Ok(ev) => match sink.emit(&ev).await {
                        Ok(()) => {
                            metrics::SINK_WRITES.inc();
                            metrics::EVENTS_PROCESSED
                                .with_label_values(&[&ev.contract_id, &ev.event_type])
                                .inc();
                            emitted = true;
                            break;
                        }
                        Err(error) => last_error = error.to_string(),
                    },
                    Err(error) => last_error = error.to_string(),
                }

                metrics::PROCESS_ERRORS.inc();
                if attempt < cfg.max_event_retries {
                    tokio::time::sleep(Duration::from_millis(100 * u64::from(attempt + 1))).await;
                }
            }

            if !emitted {
                metrics::FAILED_EVENTS.inc();
                tracing::error!(worker = id, event_id = %raw.id, error = %last_error, retries = cfg.max_event_retries, "event processing retries exhausted");
                match dead_letters
                    .push(raw, &last_error, cfg.max_event_retries.saturating_add(1))
                    .await
                {
                    Ok(true) => {
                        metrics::DEAD_LETTER_EVENTS.inc();
                        tracing::error!(worker = id, event_id = %raw.id, path = %cfg.dead_letter_file, "event written to dead-letter queue; checkpoint held for recovery");
                    }
                    Ok(false) => {}
                    Err(error) => {
                        metrics::PROCESS_ERRORS.inc();
                        tracing::error!(worker = id, event_id = %raw.id, error = %error, "dead-letter write failed");
                    }
                }
                batch_failed = true;
            }
        }

        if !batch_failed {
            if let Err(e) = checkpoints
                .save(cfg.shard.0, &batch.contract_id, batch.through_ledger)
                .await
            {
                metrics::PROCESS_ERRORS.inc();
                tracing::error!(worker = id, error = %e, "checkpoint save failed");
                batch_failed = true;
            } else {
                metrics::LAST_PROCESSED_LEDGER
                    .with_label_values(&[&batch.contract_id])
                    .set(batch.through_ledger as i64);
            }
        }
        tracing::debug!(worker = id, contract = %batch.contract_id, events = n, through = batch.through_ledger, "batch done");
        let _ = batch.done.send(!batch_failed);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::checkpoint::{CheckpointStore, FileCheckpointStore};
    use crate::config::{CheckpointBackend, SinkBackend};
    use crate::rpc::RawEvent;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::sync::Mutex;

    static NEXT_TEST_ID: AtomicU64 = AtomicU64::new(0);

    #[tokio::test]
    async fn failed_event_is_retried_and_dead_lettered_without_advancing_checkpoint() {
        let test_id = NEXT_TEST_ID.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "dukapay-indexer-pipeline-{}-{test_id}",
            std::process::id()
        ));
        tokio::fs::create_dir_all(&root).await.unwrap();
        let checkpoint_path = root.join("checkpoints.json");
        let dead_letter_path = root.join("dead-letter.ndjson");
        let checkpoint_store = FileCheckpointStore::new(checkpoint_path.to_string_lossy())
            .await
            .unwrap();
        let sink_file = std::fs::OpenOptions::new()
            .write(true)
            .open("/dev/full")
            .unwrap();
        let sink = Sink::File(Arc::new(Mutex::new(tokio::fs::File::from_std(sink_file))));
        let cfg = Arc::new(Config {
            rpc_url: "http://localhost".to_string(),
            contract_ids: vec!["contract".to_string()],
            finality_depth: 1,
            poll_interval: Duration::from_millis(1),
            batch_size: 1,
            worker_concurrency: 1,
            max_event_retries: 1,
            dead_letter_file: dead_letter_path.to_string_lossy().into_owned(),
            channel_capacity: 1,
            shard: (0, 1),
            checkpoint: CheckpointBackend::File {
                path: checkpoint_path.to_string_lossy().into_owned(),
            },
            sink: SinkBackend::Stdout,
            metrics_port: 0,
            lag_alert_threshold: 100,
        });
        let dead_letters = DeadLetterQueue::new(cfg.dead_letter_file.clone())
            .await
            .unwrap();
        let (tx, rx) = mpsc::channel(1);
        let worker = tokio::spawn(worker_loop(
            0,
            Arc::new(Mutex::new(rx)),
            sink,
            AnyCheckpointStore::File(checkpoint_store.clone()),
            dead_letters,
            cfg,
        ));
        let (done_tx, done_rx) = tokio::sync::oneshot::channel();

        let raw_event = RawEvent {
            kind: "contract".to_string(),
            ledger: 42,
            ledger_closed_at: String::new(),
            contract_id: "contract".to_string(),
            id: "event-42".to_string(),
            paging_token: String::new(),
            topic: vec!["LoanCreated".to_string()],
            value: serde_json::Value::Null,
            tx_hash: String::new(),
        };
        tx.send(Batch {
            contract_id: "contract".to_string(),
            through_ledger: 42,
            events: vec![raw_event.clone()],
            done: done_tx,
        })
        .await
        .unwrap();

        assert!(!done_rx.await.unwrap());
        assert_eq!(checkpoint_store.load(0, "contract").await.unwrap(), None);
        drop(tx);
        worker.await.unwrap().unwrap();

        let dead_letter_contents = tokio::fs::read_to_string(&dead_letter_path).await.unwrap();
        let record: serde_json::Value = serde_json::from_str(dead_letter_contents.trim()).unwrap();
        assert_eq!(record["event_id"], "event-42");
        assert_eq!(record["attempts"], 2);

        let restored_queue = DeadLetterQueue::new(dead_letter_path.to_string_lossy())
            .await
            .unwrap();
        assert!(!restored_queue
            .push(&raw_event, "duplicate", 2)
            .await
            .unwrap());
        tokio::fs::remove_dir_all(root).await.unwrap();
    }
}

/// Decode an RPC event into the normalised sink shape. The heavy XDR→native
/// decoding still lives in the TypeScript consumer; here we pass through the
/// base64 topics/value and the event type symbol so the pipeline stays cheap.
fn decode(raw: &RawEvent, shard: u32) -> Result<DecodedEvent> {
    let event_type = raw
        .topic
        .first()
        .cloned()
        .unwrap_or_else(|| "unknown".to_string());
    Ok(DecodedEvent {
        id: raw.id.clone(),
        paging_token: if raw.paging_token.is_empty() {
            raw.id.clone()
        } else {
            raw.paging_token.clone()
        },
        contract_id: raw.contract_id.clone(),
        event_type,
        ledger: raw.ledger,
        ledger_closed_at: raw.ledger_closed_at.clone(),
        tx_hash: raw.tx_hash.clone(),
        topics: raw.topic.clone(),
        value: raw.value.clone(),
        shard,
    })
}
