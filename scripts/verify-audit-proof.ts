import crypto from "node:crypto";
import fs from "node:fs";

interface Step {
  position: "left" | "right";
  hash: string;
}
interface ProofFile {
  data?: {
    entry: Record<string, unknown>;
    leafHash: string;
    merkleRoot: string;
    proof: Step[];
  };
  entry?: Record<string, unknown>;
  leafHash?: string;
  merkleRoot?: string;
  proof?: Step[];
}

const filename = process.argv[2];
if (!filename) throw new Error("Usage: npm run audit:verify -- <proof.json>");
const document = JSON.parse(fs.readFileSync(filename, "utf8")) as ProofFile;
const proof = document.data ?? document;
if (!proof.entry || !proof.leafHash || !proof.merkleRoot || !proof.proof) {
  throw new Error("Invalid proof document");
}
const sha256 = (value: Buffer | string): string =>
  crypto.createHash("sha256").update(value).digest("hex");
const entry = proof.entry;
const canonical = JSON.stringify({
  id: Number(entry.id),
  actor: entry.actor ?? null,
  action: entry.action ?? null,
  target: entry.target ?? null,
  payload: entry.payload ?? null,
  ip_address: entry.ip_address ?? null,
  status: entry.status ?? null,
  created_at: String(entry.created_at),
});
if (sha256(canonical) !== proof.leafHash)
  throw new Error("Audit entry hash does not match proof leaf");
let current = proof.leafHash;
for (const step of proof.proof) {
  const left = step.position === "left" ? step.hash : current;
  const right = step.position === "right" ? step.hash : current;
  current = sha256(
    Buffer.concat([Buffer.from(left, "hex"), Buffer.from(right, "hex")]),
  );
}
if (current !== proof.merkleRoot)
  throw new Error("Merkle proof verification failed");
process.stdout.write(
  `Verified audit log ${String(entry.id)} against root ${proof.merkleRoot}\n`,
);
