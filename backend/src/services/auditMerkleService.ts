import crypto from 'node:crypto';
import {
  BASE_FEE,
  Keypair,
  Operation,
  TransactionBuilder,
  nativeToScVal,
} from '@stellar/stellar-sdk';
import { query, withTransaction, type PoolClient } from '../db/connection.js';
import { createSorobanRpcServer, getStellarNetworkPassphrase } from '../config/stellar.js';
import logger from '../utils/logger.js';

export interface MerkleStep {
  position: 'left' | 'right';
  hash: string;
}

export interface AuditProof {
  logId: number;
  leafHash: string;
  leafIndex: number;
  merkleRoot: string;
  proof: MerkleStep[];
  epochStart: string;
  epochEnd: string;
  stellarTxHash: string | null;
  anchorStatus: string;
  anchorContractId: string | null;
  entry: Record<string, unknown>;
}

const sha256 = (value: Buffer | string): string =>
  crypto.createHash('sha256').update(value).digest('hex');

export function canonicalAuditEntry(row: Record<string, unknown>): string {
  const createdAt =
    row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at);
  return JSON.stringify({
    id: Number(row.id),
    actor: row.actor ?? null,
    action: row.action ?? null,
    target: row.target ?? null,
    payload: row.payload ?? null,
    ip_address: row.ip_address ?? null,
    status: row.status ?? null,
    created_at: createdAt,
  });
}

export const hashAuditEntry = (row: Record<string, unknown>): string =>
  sha256(canonicalAuditEntry(row));

export function merkleRoot(leaves: string[]): string {
  if (leaves.length === 0) return sha256('');
  let level = [...leaves];
  while (level.length > 1) {
    const next: string[] = [];
    for (let index = 0; index < level.length; index += 2) {
      const left = level[index]!;
      const right = level[index + 1] ?? left;
      next.push(sha256(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])));
    }
    level = next;
  }
  return level[0]!;
}

export function merkleProof(leaves: string[], leafIndex: number): MerkleStep[] {
  if (leafIndex < 0 || leafIndex >= leaves.length) throw new Error('Invalid leaf index');
  const proof: MerkleStep[] = [];
  let index = leafIndex;
  let level = [...leaves];
  while (level.length > 1) {
    const siblingIndex = index % 2 === 0 ? index + 1 : index - 1;
    proof.push({
      position: index % 2 === 0 ? 'right' : 'left',
      hash: level[siblingIndex] ?? level[index]!,
    });
    const next: string[] = [];
    for (let cursor = 0; cursor < level.length; cursor += 2) {
      const left = level[cursor]!;
      const right = level[cursor + 1] ?? left;
      next.push(sha256(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')])));
    }
    index = Math.floor(index / 2);
    level = next;
  }
  return proof;
}

export function verifyMerkleProof(
  leafHash: string,
  proof: MerkleStep[],
  expectedRoot: string,
): boolean {
  let current = leafHash;
  for (const step of proof) {
    const left = step.position === 'left' ? step.hash : current;
    const right = step.position === 'right' ? step.hash : current;
    current = sha256(Buffer.concat([Buffer.from(left, 'hex'), Buffer.from(right, 'hex')]));
  }
  return current === expectedRoot;
}

async function createEpoch(client: PoolClient, start: Date, end: Date): Promise<number | null> {
  const logs = await client.query(
    `SELECT id, actor, action, target, payload, ip_address, status, created_at
     FROM audit_logs WHERE created_at >= $1 AND created_at < $2
     ORDER BY id ASC`,
    [start, end],
  );
  if (logs.rows.length === 0) return null;
  const leaves = logs.rows.map((row) => hashAuditEntry(row));
  const epoch = await client.query(
    `INSERT INTO audit_epochs (epoch_start, epoch_end, merkle_root, leaf_count)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (epoch_start) DO NOTHING RETURNING id`,
    [start, end, merkleRoot(leaves), leaves.length],
  );
  if (!epoch.rows[0]) return null;
  const epochId = Number(epoch.rows[0].id);
  for (let index = 0; index < logs.rows.length; index += 1) {
    await client.query(
      `INSERT INTO audit_merkle_leaves (epoch_id, log_id, leaf_index, leaf_hash)
       VALUES ($1, $2, $3, $4)`,
      [epochId, logs.rows[index]!.id, index, leaves[index]],
    );
  }
  return epochId;
}

async function anchorEpoch(epoch: Record<string, unknown>): Promise<void> {
  const contractId = process.env.AUDIT_ANCHOR_CONTRACT_ID;
  const secret = process.env.AUDIT_ANCHOR_SOURCE_SECRET;
  if (!contractId || !secret) return;
  const signer = Keypair.fromSecret(secret);
  const server = createSorobanRpcServer();
  if (epoch.stellar_tx_hash) {
    const existingHash = String(epoch.stellar_tx_hash);
    const existing = await server.pollTransaction(existingHash, { attempts: 3 });
    if (existing.status === 'SUCCESS') {
      await query(
        `UPDATE audit_epochs SET anchor_status = 'anchored', anchored_at = NOW() WHERE id = $1`,
        [epoch.id],
      );
      return;
    }
    if (existing.status === 'FAILED') {
      await query('UPDATE audit_epochs SET stellar_tx_hash = NULL WHERE id = $1', [epoch.id]);
    } else {
      throw new Error(`Anchor transaction remains ${existing.status}`);
    }
  }
  const account = await server.getAccount(signer.publicKey());
  const epochSeconds = Math.floor(new Date(String(epoch.epoch_start)).getTime() / 1000);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: getStellarNetworkPassphrase(),
  })
    .addOperation(
      Operation.invokeContractFunction({
        contract: contractId,
        function: 'anchor',
        args: [
          nativeToScVal(epochSeconds, { type: 'u64' }),
          nativeToScVal(Buffer.from(String(epoch.merkle_root), 'hex'), { type: 'bytes' }),
          nativeToScVal(Number(epoch.leaf_count), { type: 'u32' }),
        ],
      }),
    )
    .setTimeout(30)
    .build();
  const prepared = await server.prepareTransaction(tx);
  prepared.sign(signer);
  const sent = await server.sendTransaction(prepared);
  if (!sent.hash) throw new Error('Anchor submission returned no transaction hash');
  await query('UPDATE audit_epochs SET stellar_tx_hash = $1 WHERE id = $2', [sent.hash, epoch.id]);
  const result = await server.pollTransaction(sent.hash, { attempts: 10 });
  if (result.status !== 'SUCCESS')
    throw new Error(`Anchor transaction ended with ${result.status}`);
  await query(
    `UPDATE audit_epochs SET anchor_status = 'anchored', stellar_tx_hash = $1, anchored_at = NOW()
     WHERE id = $2`,
    [sent.hash, epoch.id],
  );
}

export const auditMerkleService = {
  async sealAndAnchor(): Promise<void> {
    const latestClosedHour = new Date();
    latestClosedHour.setUTCMinutes(0, 0, 0);
    const hours = await query(
      `SELECT DISTINCT date_trunc('hour', created_at) AS epoch_start
       FROM audit_logs l
       WHERE created_at < $1 AND NOT EXISTS (
         SELECT 1 FROM audit_merkle_leaves ml WHERE ml.log_id = l.id
       ) ORDER BY epoch_start ASC LIMIT 24`,
      [latestClosedHour],
    );
    for (const row of hours.rows) {
      const start = new Date(row.epoch_start);
      const end = new Date(start.getTime() + 60 * 60 * 1000);
      await withTransaction((client) => createEpoch(client, start, end));
    }

    const pending = await query(
      `SELECT id, epoch_start, merkle_root, leaf_count, stellar_tx_hash FROM audit_epochs
       WHERE anchor_status IN ('pending', 'failed') ORDER BY epoch_start ASC LIMIT 24`,
    );
    for (const epoch of pending.rows) {
      try {
        await anchorEpoch(epoch);
      } catch (error) {
        await query("UPDATE audit_epochs SET anchor_status = 'failed' WHERE id = $1", [epoch.id]);
        logger.withContext().error('Audit epoch anchoring failed', {
          epochId: epoch.id,
          reason: error instanceof Error ? error.message : 'unknown',
        });
      }
    }
  },

  async getProof(logId: number): Promise<AuditProof | null> {
    const leafResult = await query(
      `SELECT ml.leaf_index, ml.leaf_hash, ae.id AS epoch_id, ae.epoch_start, ae.epoch_end,
              ae.merkle_root, ae.stellar_tx_hash, ae.anchor_status,
              l.id, l.actor, l.action, l.target, l.payload, l.ip_address, l.status, l.created_at
       FROM audit_merkle_leaves ml JOIN audit_epochs ae ON ae.id = ml.epoch_id
       JOIN audit_logs l ON l.id = ml.log_id WHERE ml.log_id = $1`,
      [logId],
    );
    if (!leafResult.rows[0]) return null;
    const row = leafResult.rows[0];
    const leaves = await query(
      'SELECT leaf_hash FROM audit_merkle_leaves WHERE epoch_id = $1 ORDER BY leaf_index ASC',
      [row.epoch_id],
    );
    const hashes = leaves.rows.map((leaf) => String(leaf.leaf_hash));
    const entry = {
      id: row.id,
      actor: row.actor,
      action: row.action,
      target: row.target,
      payload: row.payload,
      ip_address: row.ip_address,
      status: row.status,
      created_at: row.created_at,
    };
    return {
      logId,
      leafHash: String(row.leaf_hash),
      leafIndex: Number(row.leaf_index),
      merkleRoot: String(row.merkle_root),
      proof: merkleProof(hashes, Number(row.leaf_index)),
      epochStart: new Date(row.epoch_start).toISOString(),
      epochEnd: new Date(row.epoch_end).toISOString(),
      stellarTxHash: row.stellar_tx_hash ? String(row.stellar_tx_hash) : null,
      anchorStatus: String(row.anchor_status),
      entry,
      anchorContractId: process.env.AUDIT_ANCHOR_CONTRACT_ID ?? null,
    };
  },
};
