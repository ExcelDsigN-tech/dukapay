//! Prometheus metrics + a tiny HTTP server exposing `/metrics` and `/healthz`.
//! Health signals: lag (ledgers behind tip), throughput (events/sec via counter
//! rate), error rate (fetch/process error counters).

use anyhow::Result;
use http_body_util::Full;
use hyper::body::Bytes;
use hyper::service::service_fn;
use hyper::{Request, Response, StatusCode};
use hyper_util::rt::TokioIo;
use once_cell::sync::Lazy;
use prometheus::{
    register_int_counter, register_int_counter_vec, register_int_gauge, register_int_gauge_vec,
    Encoder, IntCounter, IntCounterVec, IntGauge, IntGaugeVec, TextEncoder,
};
use std::sync::atomic::{AtomicBool, Ordering};
use tokio::net::TcpListener;

pub static LEDGER_LAG: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "indexer_ledger_lag",
        "Ledgers between the last processed ledger and the network tip",
        &["contract_id"]
    )
    .unwrap()
});

pub static LAG_OK: Lazy<IntGauge> = Lazy::new(|| {
    register_int_gauge!(
        "indexer_lag_ok",
        "1 when all contracts are within the lag alert threshold, else 0"
    )
    .unwrap()
});

pub static LAST_PROCESSED_LEDGER: Lazy<IntGaugeVec> = Lazy::new(|| {
    register_int_gauge_vec!(
        "indexer_last_processed_ledger",
        "Last fully processed ledger per contract",
        &["contract_id"]
    )
    .unwrap()
});

pub static EVENTS_PROCESSED: Lazy<IntCounterVec> = Lazy::new(|| {
    register_int_counter_vec!(
        "indexer_events_processed_total",
        "Contract events decoded and emitted to the sink",
        &["contract_id", "event_type"]
    )
    .unwrap()
});

pub static FETCH_ERRORS: Lazy<IntCounter> =
    Lazy::new(|| register_int_counter!("indexer_fetch_errors_total", "RPC fetch errors").unwrap());

pub static PROCESS_ERRORS: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!(
        "indexer_process_errors_total",
        "Errors while decoding or emitting an event"
    )
    .unwrap()
});

pub static SINK_WRITES: Lazy<IntCounter> = Lazy::new(|| {
    register_int_counter!("indexer_sink_writes_total", "Successful sink writes").unwrap()
});

static READY: AtomicBool = AtomicBool::new(false);

pub fn set_ready(v: bool) {
    READY.store(v, Ordering::Relaxed);
}

async fn handle(req: Request<hyper::body::Incoming>) -> Result<Response<Full<Bytes>>> {
    let resp = match req.uri().path() {
        "/metrics" => {
            let mut buf = Vec::new();
            let encoder = TextEncoder::new();
            encoder.encode(&prometheus::gather(), &mut buf)?;
            Response::builder()
                .header("content-type", encoder.format_type())
                .body(Full::new(Bytes::from(buf)))?
        }
        "/healthz" => Response::new(Full::new(Bytes::from("ok"))),
        "/readyz" => {
            if READY.load(Ordering::Relaxed) {
                Response::new(Full::new(Bytes::from("ready")))
            } else {
                Response::builder()
                    .status(StatusCode::SERVICE_UNAVAILABLE)
                    .body(Full::new(Bytes::from("starting")))?
            }
        }
        _ => Response::builder()
            .status(StatusCode::NOT_FOUND)
            .body(Full::new(Bytes::from("not found")))?,
    };
    Ok(resp)
}

pub async fn serve(port: u16) -> Result<()> {
    let listener = TcpListener::bind(("0.0.0.0", port)).await?;
    tracing::info!(port, "metrics server listening");
    loop {
        let (stream, _) = listener.accept().await?;
        let io = TokioIo::new(stream);
        tokio::spawn(async move {
            if let Err(e) = hyper::server::conn::http1::Builder::new()
                .serve_connection(io, service_fn(handle))
                .await
            {
                tracing::debug!(error = %e, "metrics connection closed");
            }
        });
    }
}
