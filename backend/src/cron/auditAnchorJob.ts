import cron, { type ScheduledTask } from 'node-cron';
import { auditMerkleService } from '../services/auditMerkleService.js';
import logger from '../utils/logger.js';

let task: ScheduledTask | null = null;

export function startAuditAnchorJob(): void {
  if (task || process.env.AUDIT_ANCHOR_ENABLED !== 'true') return;
  task = cron.schedule('5 * * * *', () => {
    auditMerkleService.sealAndAnchor().catch((error) => {
      logger.withContext().error('Audit Merkle epoch job failed', {
        reason: error instanceof Error ? error.message : 'unknown',
      });
    });
  });
  void auditMerkleService.sealAndAnchor();
}

export function stopAuditAnchorJob(): void {
  task?.stop();
  task = null;
}
