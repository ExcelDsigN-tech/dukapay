//! Minimal async Soroban-RPC client. Only the two JSON-RPC methods the indexer
//! needs are implemented: `getLatestLedger` and `getEvents`.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use serde_json::json;

#[derive(Clone)]
pub struct SorobanRpc {
    http: reqwest::Client,
    url: String,
}

#[derive(Debug, Deserialize)]
struct JsonRpcResponse<T> {
    result: Option<T>,
    error: Option<JsonRpcError>,
}

#[derive(Debug, Deserialize)]
struct JsonRpcError {
    code: i64,
    message: String,
}

#[derive(Debug, Deserialize)]
pub struct LatestLedger {
    pub sequence: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RawEvent {
    #[serde(rename = "type")]
    pub kind: String,
    pub ledger: u32,
    #[serde(rename = "ledgerClosedAt")]
    pub ledger_closed_at: String,
    #[serde(rename = "contractId")]
    pub contract_id: String,
    pub id: String,
    #[serde(rename = "pagingToken", default)]
    pub paging_token: String,
    #[serde(default)]
    pub topic: Vec<String>,
    #[serde(default)]
    pub value: serde_json::Value,
    #[serde(rename = "txHash", default)]
    pub tx_hash: String,
}

#[derive(Debug, Deserialize)]
pub struct GetEventsResult {
    #[serde(default)]
    pub events: Vec<RawEvent>,
    /// Network tip reported alongside the page; retained for observability.
    #[serde(rename = "latestLedger", default)]
    #[allow(dead_code)]
    pub latest_ledger: u32,
    #[serde(rename = "cursor", default)]
    pub cursor: Option<String>,
}

impl SorobanRpc {
    pub fn new(url: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("reqwest client"),
            url: url.into(),
        }
    }

    async fn call<T: for<'de> Deserialize<'de>>(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<T> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let resp: JsonRpcResponse<T> = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .await
            .with_context(|| format!("rpc {method} transport"))?
            .error_for_status()
            .with_context(|| format!("rpc {method} http status"))?
            .json()
            .await
            .with_context(|| format!("rpc {method} decode"))?;

        if let Some(err) = resp.error {
            anyhow::bail!("rpc {method} error {}: {}", err.code, err.message);
        }
        resp.result.context("rpc response missing result")
    }

    pub async fn latest_ledger(&self) -> Result<u32> {
        let r: LatestLedger = self.call("getLatestLedger", json!({})).await?;
        Ok(r.sequence)
    }

    /// Fetch events for the given contracts in [start_ledger, ..] up to a page.
    /// Soroban-RPC caps the ledger span; the caller drives pagination by cursor.
    pub async fn get_events(
        &self,
        start_ledger: u32,
        contract_ids: &[String],
        cursor: Option<&str>,
        limit: u32,
    ) -> Result<GetEventsResult> {
        let mut filter = json!({
            "type": "contract",
            "contractIds": contract_ids,
        });
        let mut pagination = json!({ "limit": limit });
        match cursor {
            Some(c) => {
                pagination["cursor"] = json!(c);
            }
            None => {
                filter["startLedger"] = json!(start_ledger);
            }
        }
        let params = json!({ "filters": [filter], "pagination": pagination });
        self.call("getEvents", params).await
    }
}
