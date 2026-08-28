//! The core indexing loop: one fetcher task per owned contract pushes finalised
//! events into a bounded channel; a pool of workers decodes and emits them in
//! parallel; checkpoints advance only after the whole batch for a ledger range
//! has been drained.

use crate::checkpoint::AnyCheckpointStore;
use crate::config::Config;
use crate::metrics;
use crate::rpc::{RawEvent, SorobanRpc};
use crate::sink::{DecodedEvent, Sink};
use anyhow::Result;
use std::sync::Arc;
use tokio::sync::mpsc;

struct Batch {
    contract_id: String,
    /// Exclusive upper bound processed once every event here is emitted.
    through_ledger: u32,
    events: Vec<RawEvent>,
    done: tokio::sync::oneshot::Sender<()>,
}

pub async fn run(cfg: Config) -> Result<()> {
    let cfg = Arc::new(cfg);
    let rpc = SorobanRpc::new(cfg.rpc_url.clone());
    let sink = Sink::connect(&cfg.sink).await?;
    let checkpoints = build_checkpoint_store(&cfg).await?;

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
        let cfg = cfg.clone();
        workers.push(tokio::spawn(async move {
            worker_loop(id, rx, sink, checkpoints, cfg).await
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
        loop {
            let page = match rpc
                .get_events(
                    next_ledger,
                    &[contract.clone()],
                    cursor.as_deref(),
                    cfg.batch_size,
                )
                .await
            {
                Ok(p) => p,
                Err(e) => {
                    metrics::FETCH_ERRORS.inc();
                    tracing::warn!(%contract, error = %e, "get_events failed");
                    tokio::time::sleep(cfg.poll_interval).await;
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
        let _ = done_rx.await;
        next_ledger = through + 1;
    }
}

async fn worker_loop(
    id: usize,
    rx: Arc<tokio::sync::Mutex<mpsc::Receiver<Batch>>>,
    sink: Sink,
    checkpoints: AnyCheckpointStore,
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
        for raw in &batch.events {
            match decode(raw, cfg.shard.0) {
                Ok(ev) => {
                    if let Err(e) = sink.emit(&ev).await {
                        metrics::PROCESS_ERRORS.inc();
                        tracing::error!(worker = id, error = %e, "sink emit failed");
                        // Do not checkpoint past an event we failed to emit.
                        continue;
                    }
                    metrics::SINK_WRITES.inc();
                    metrics::EVENTS_PROCESSED
                        .with_label_values(&[&ev.contract_id, &ev.event_type])
                        .inc();
                }
                Err(e) => {
                    metrics::PROCESS_ERRORS.inc();
                    tracing::error!(worker = id, error = %e, "decode failed");
                }
            }
        }

        if let Err(e) = checkpoints
            .save(cfg.shard.0, &batch.contract_id, batch.through_ledger)
            .await
        {
            metrics::PROCESS_ERRORS.inc();
            tracing::error!(worker = id, error = %e, "checkpoint save failed");
        } else {
            metrics::LAST_PROCESSED_LEDGER
                .with_label_values(&[&batch.contract_id])
                .set(batch.through_ledger as i64);
        }
        tracing::debug!(worker = id, contract = %batch.contract_id, events = n, through = batch.through_ledger, "batch done");
        let _ = batch.done.send(());
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
