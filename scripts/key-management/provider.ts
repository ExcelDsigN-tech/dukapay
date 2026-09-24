/**
 * provider.ts — provider-agnostic signing-key adapter for DukaPay.
 *
 * This is a SCAFFOLD. It defines the `SigningProvider` interface and two
 * reference implementations (AWS CloudHSM, Fireblocks). Real key material is
 * generated and stored INSIDE the HSM / MPC and is never returned to this
 * process in plaintext. Configuration supplies opaque key *references* only.
 *
 * Wire these to your cloud account, then call from deploy.ts / oracle feed /
 * agent settlement / backend JWT.
 */

export type KeyType = "deployer" | "admin" | "oracle" | "operator" | "jwt";

export interface SigningProvider {
  /** Opaque reference to the key (ARN, vault/key id). Never the key bytes. */
  readonly keyRef: string;
  /** Sign `payload`, returning a detached signature (base64). */
  sign(payload: Buffer): Promise<string>;
  /** Public key / address derived from the key reference. */
  publicKey(): Promise<string>;
  /** Provision a new key version; returns the new opaque reference. */
  rotate(): Promise<string>;
  /** Disable / zeroize the current key version (emergency revocation). */
  revoke(): Promise<void>;
}

/** Resolve the opaque key reference for a given key type from config. */
function refFor(type: KeyType): string {
  const envMap: Record<KeyType, string> = {
    deployer: "DUKAPAY_DEPLOYER_KEYREF",
    admin: "DUKAPAY_ADMIN_KEYREF",
    oracle: "DUKAPAY_ORACLE_KEYREF",
    operator: "DUKAPAY_OPERATOR_KEYREF",
    jwt: "DUKAPAY_JWT_KEYREF",
  };
  const ref = process.env[envMap[type]];
  if (!ref) {
    throw new Error(`No key reference configured for '${type}' (set ${envMap[type]})`);
  }
  return ref;
}

/**
 * AWS CloudHSM (or KMS) implementation.
 * Uses the PKCS#11 / KMS sign API; the key never leaves the HSM.
 */
export class CloudHsmProvider implements SigningProvider {
  constructor(public readonly keyRef: string) {}
  static for(type: KeyType) {
    return new CloudHsmProvider(refFor(type));
  }
  async sign(payload: Buffer): Promise<string> {
    // TODO: call AWS KMS / CloudHSM sign with this.keyRef.
    // const kms = new KMSClient(...);
    // const out = await kms.send(new SignCommand({ KeyId: this.keyRef, Message: payload }));
    throw new Error("CloudHsmProvider.sign not wired — implement per your AWS account");
  }
  async publicKey(): Promise<string> {
    throw new Error("CloudHsmProvider.publicKey not wired");
  }
  async rotate(): Promise<string> {
    // TODO: kms.createKey / cloudhsm create-key; return new key ARN.
    throw new Error("CloudHsmProvider.rotate not wired");
  }
  async revoke(): Promise<void> {
    // TODO: cloudhsm delete-key (zeroize) / kms disable + schedule-key-deletion.
    throw new Error("CloudHsmProvider.revoke not wired");
  }
}

/**
 * Fireblocks MPC implementation.
 * Uses the Fireblocks API; signing is performed inside the MPC.
 */
export class FireblocksProvider implements SigningProvider {
  constructor(public readonly keyRef: string) {}
  static for(type: KeyType) {
    return new FireblocksProvider(refFor(type));
  }
  async sign(payload: Buffer): Promise<string> {
    // TODO: use Fireblocks SDK transaction / raw signing with this.keyRef.
    throw new Error("FireblocksProvider.sign not wired — implement per your Fireblocks vault");
  }
  async publicKey(): Promise<string> {
    throw new Error("FireblocksProvider.publicKey not wired");
  }
  async rotate(): Promise<string> {
    // TODO: Fireblocks vault / key creation; return new key id.
    throw new Error("FireblocksProvider.rotate not wired");
  }
  async revoke(): Promise<void> {
    // TODO: Fireblocks key revocation / vault lockdown.
    throw new Error("FireblocksProvider.revoke not wired");
  }
}

export function providerFor(type: KeyType): SigningProvider {
  const which = (process.env.DUKAPAY_PROVIDER ?? "cloudhsm").toLowerCase();
  return which === "fireblocks"
    ? FireblocksProvider.for(type)
    : CloudHsmProvider.for(type);
}

// --- CLI entrypoint used by provider.sh -------------------------------

async function main() {
  const [action, type, ref] = process.argv.slice(2);
  switch (action) {
    case "rotate": {
      const p = providerFor(type as KeyType);
      const newRef = await p.rotate();
      process.stdout.write(`${newRef}\n`);
      break;
    }
    case "register": {
      const p = providerFor(type as KeyType);
      const pub = await p.publicKey();
      process.stdout.write(`${pub}\n`);
      break;
    }
    case "revoke": {
      const p = providerFor(type as KeyType);
      await p.revoke();
      break;
    }
    default:
      process.stderr.write("unknown action\n");
      process.exit(2);
  }
}

if (require.main === module) {
  main().catch((e) => {
    process.stderr.write(`${e}\n`);
    process.exit(1);
  });
}
