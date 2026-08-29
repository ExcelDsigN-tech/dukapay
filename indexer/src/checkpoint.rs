//! Checkpoint persistence. A checkpoint is the last fully-processed ledger for a
//! given (shard, contract) pair. On restart the indexer resumes from
//! `checkpoint + 1`, guaranteeing at-least-once delivery.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;

/// Checkpoint store contract. Implemented for a file and for Postgres; the
/// concrete backend is selected at startup and wrapped in [`AnyCheckpointStore`].
#[allow(async_fn_in_trait)]
pub trait CheckpointStore: Send + Sync {
    async fn load(&self, shard: u32, contract: &str) -> Result<Option<u32>>;
    async fn save(&self, shard: u32, contract: &str, ledger: u32) -> Result<()>;
}

// ── File-backed ───────────────────────────────────────────────────────────────

#[derive(Clone)]
pub struct FileCheckpointStore {
    path: String,
    cache: Arc<Mutex<HashMap<String, u32>>>,
}

impl FileCheckpointStore {
    pub async fn new(path: impl Into<String>) -> Result<Self> {
        let path = path.into();
        let cache = match tokio::fs::read(&path).await {
            Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(e) => return Err(e.into()),
        };
        Ok(Self {
            path,
            cache: Arc::new(Mutex::new(cache)),
        })
    }

    fn key(shard: u32, contract: &str) -> String {
        format!("{shard}:{contract}")
    }
}

impl CheckpointStore for FileCheckpointStore {
    async fn load(&self, shard: u32, contract: &str) -> Result<Option<u32>> {
        Ok(self
            .cache
            .lock()
            .await
            .get(&Self::key(shard, contract))
            .copied())
    }

    async fn save(&self, shard: u32, contract: &str, ledger: u32) -> Result<()> {
        let mut cache = self.cache.lock().await;
        cache.insert(Self::key(shard, contract), ledger);
        let tmp = format!("{}.tmp", self.path);
        tokio::fs::write(&tmp, serde_json::to_vec_pretty(&*cache)?).await?;
        tokio::fs::rename(&tmp, &self.path).await?;
        Ok(())
    }
}

// ── Postgres-backed ───────────────────────────────────────────────────────────

#[cfg(feature = "postgres")]
#[derive(Clone)]
pub struct PgCheckpointStore {
    pool: sqlx::PgPool,
}

#[cfg(feature = "postgres")]
impl PgCheckpointStore {
    pub async fn new(url: &str) -> Result<Self> {
        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(4)
            .connect(url)
            .await?;
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS indexer_checkpoints (
                shard        INT         NOT NULL,
                contract_id  TEXT        NOT NULL,
                last_ledger  BIGINT      NOT NULL,
                updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
                PRIMARY KEY (shard, contract_id)
            )
            "#,
        )
        .execute(&pool)
        .await?;
        Ok(Self { pool })
    }
}

#[cfg(feature = "postgres")]
impl CheckpointStore for PgCheckpointStore {
    async fn load(&self, shard: u32, contract: &str) -> Result<Option<u32>> {
        let row: Option<(i64,)> = sqlx::query_as(
            "SELECT last_ledger FROM indexer_checkpoints WHERE shard = $1 AND contract_id = $2",
        )
        .bind(shard as i32)
        .bind(contract)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row.map(|(l,)| l as u32))
    }

    async fn save(&self, shard: u32, contract: &str, ledger: u32) -> Result<()> {
        sqlx::query(
            r#"
            INSERT INTO indexer_checkpoints (shard, contract_id, last_ledger)
            VALUES ($1, $2, $3)
            ON CONFLICT (shard, contract_id)
            DO UPDATE SET last_ledger = GREATEST(indexer_checkpoints.last_ledger, EXCLUDED.last_ledger),
                          updated_at  = now()
            "#,
        )
        .bind(shard as i32)
        .bind(contract)
        .bind(ledger as i64)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}

// ── Dyn wrapper ───────────────────────────────────────────────────────────────

/// Runtime-selected checkpoint store.
#[derive(Clone)]
pub enum AnyCheckpointStore {
    File(FileCheckpointStore),
    #[cfg(feature = "postgres")]
    Pg(PgCheckpointStore),
}

impl AnyCheckpointStore {
    pub async fn load(&self, shard: u32, contract: &str) -> Result<Option<u32>> {
        match self {
            Self::File(s) => s.load(shard, contract).await,
            #[cfg(feature = "postgres")]
            Self::Pg(s) => s.load(shard, contract).await,
        }
    }

    pub async fn save(&self, shard: u32, contract: &str, ledger: u32) -> Result<()> {
        match self {
            Self::File(s) => s.save(shard, contract, ledger).await,
            #[cfg(feature = "postgres")]
            Self::Pg(s) => s.save(shard, contract, ledger).await,
        }
    }
}
