import { describe, expect, it } from '@jest/globals';
import { merkleProof, merkleRoot, verifyMerkleProof } from '../services/auditMerkleService.js';
import crypto from 'node:crypto';

const hash = (value: string): string => crypto.createHash('sha256').update(value).digest('hex');

describe('audit Merkle proofs', () => {
  it('verifies every leaf in odd-sized epochs', () => {
    const leaves = ['one', 'two', 'three'].map(hash);
    const root = merkleRoot(leaves);
    leaves.forEach((leaf, index) => {
      expect(verifyMerkleProof(leaf, merkleProof(leaves, index), root)).toBe(true);
    });
  });

  it('rejects a modified leaf', () => {
    const leaves = ['one', 'two'].map(hash);
    expect(verifyMerkleProof(hash('tampered'), merkleProof(leaves, 0), merkleRoot(leaves))).toBe(
      false,
    );
  });
});
