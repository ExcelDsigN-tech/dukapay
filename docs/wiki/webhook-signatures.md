# Webhook Signature Verification

Every outbound webhook delivery from DukaPay includes an
`X-DukaPay-Signature` header that allows subscribers to verify the
payload was not tampered with in transit and to detect replay attacks.

## Signed payload

The HMAC is computed over a **signed payload** of the form:

```
<timestamp>.<nonce>.<body_hex>
```

| Component  | Description                                                        |
| ---------- | ------------------------------------------------------------------ |
| timestamp  | Unix epoch seconds (sent in the `X-DukaPay-Timestamp` header).   |
| nonce      | A 32-character hex string (sent in the `X-DukaPay-Nonce` header). |
| body_hex   | The UTF-8 request body, hex-encoded.                              |

Including the timestamp and nonce in the signed payload means a replay
attack is detected both by an expired timestamp and by a duplicate nonce.

## Header format

```
X-DukaPay-Signature: sha256=<hex-encoded-hmac>
X-DukaPay-Timestamp: 1726800000
X-DukaPay-Nonce:     4f3a…9e
```

The signature value is `sha256=` followed by the lowercase hex-encoded
HMAC-SHA256 digest of the signed payload string (described above) using
the subscriber secret that was supplied when the subscription was
registered.

## Verification recipe

### Step 1 — Reconstruct the signed payload

```
signedPayload = `${timestamp}.${nonce}.${body_hex}`
```

### Step 2 — Compute the expected signature

```
expected = "sha256=" + HMAC-SHA256(secret, signedPayload)
```

### Step 3 — Compare with `timingSafeEqual`

Reject the request if `expected !== received`.

### Step 4 — Timestamp check (replay protection)

Compare `X-DukaPay-Timestamp` to the current time.  If the difference
exceeds **300 seconds** (5 minutes), reject the request.  DukaPay
accepts `WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS` as an upper bound;
subscribers should enforce an equivalent window on their side.

### Step 5 — Nonce deduplication

Track every nonce you have seen within the timestamp-tolerance window
(e.g. in Redis with a TTL).  If a nonce recurs, reject the request.

### Node.js

```js
import crypto from "node:crypto";

// YOUR_SUBSCRIPTION_SECRET is the per-subscription secret returned
// when you registered the webhook, not an env var.
const SECRET = YOUR_SUBSCRIPTION_SECRET;
const MAX_AGE_SECONDS = 300;

// Express with raw body — parse the body BEFORE JSON-decoding.
app.post("/webhook", express.raw({ type: "application/json" }), (req, res) => {
  const sig = req.headers["x-dukapay-signature"];
  const ts = req.headers["x-dukapay-timestamp"];
  const nonce = req.headers["x-dukapay-nonce"];
  const bodyHex = req.body.toString("hex");

  if (!verifySignature(SECRET, ts, nonce, bodyHex, sig)) {
    return res.status(401).send("Invalid signature");
  }

  if (!checkTimestamp(ts, MAX_AGE_SECONDS)) {
    return res.status(401).send("Timestamp out of tolerance");
  }

  if (isNonceReplayed(nonce)) {
    return res.status(401).send("Replay detected");
  }

  saveNonce(nonce, MAX_AGE_SECONDS);

  const payload = JSON.parse(req.body.toString("utf8"));
  // process payload …
  res.sendStatus(200);
});

function verifySignature(secret, timestamp, nonce, bodyHex, signatureHeader) {
  if (!signatureHeader || !timestamp || !nonce) return false;

  const signedPayload = `${timestamp}.${nonce}.${bodyHex}`;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");

  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function checkTimestamp(tsHeader, tolerance) {
  const ts = Number.parseInt(tsHeader, 10);
  if (Number.isNaN(ts)) return false;
  const age = Math.floor(Date.now() / 1000) - ts;
  return Math.abs(age) <= tolerance;
}

function isNonceReplayed(nonce) {
  /* your store lookup */ return false;
}

function saveNonce(nonce, ttl) {
  /* store nonce with TTL */
}
```

### Python

```python
import hmac, hashlib, time, secrets

SECRET = YOUR_SUBSCRIPTION_SECRET
MAX_AGE_SECONDS = 300

def verify_webhook(request_body: bytes, headers: dict) -> bool:
    sig = headers.get("x-dukapay-signature", "")
    ts_str = headers.get("x-dukapay-timestamp", "")
    nonce = headers.get("x-dukapay-nonce", "")

    # Step 4 — timestamp check
    try:
        ts = int(ts_str)
    except (TypeError, ValueError):
        return False
    age = abs(int(time.time()) - ts)
    if age > MAX_AGE_SECONDS:
        return False

    # Step 1 + 2 — reconstruct & compute
    body_hex = request_body.decode("utf-8").encode("utf-8").hex()
    signed_payload = f"{ts_str}.{nonce}.{body_hex}"
    expected = "sha256=" + hmac.new(
        SECRET.encode(), signed_payload.encode(), hashlib.sha256
    ).hexdigest()

    # Step 3 — compare
    return hmac.compare_digest(expected, sig)
```

## Key rotation

When rotating the subscriber secret:

1. Generate a new secret and update the subscription via the API or UI.
2. Configure the consumer to accept **both** the old and new secrets
   for a short overlap window (e.g. 15 minutes).
3. After the overlap period, drop the old secret.

The server-side `WEBHOOK_SECRET` environment variable holds the primary
secret.  Additional previously-used secrets can be listed in
`WEBHOOK_ROTATION_SECRETS` (comma-separated) so that the internal
delivery pipeline can sign with the primary secret while consumers
migrate.  See `webhookService.ts` — the exported `verifyWebhookSignature`
function accepts a list of `candidateSecrets` and returns `true` on the
first match.

## Notes

- The `Authorization: Bearer <secret>` header is also present for
  backwards compatibility with existing subscribers that have not yet
  adopted HMAC verification, but **`X-DukaPay-Signature` is the
  authoritative integrity check**.
- Always parse the raw body bytes *before* JSON-decoding; most
  frameworks let you configure a raw-body parser for webhook routes.
- The signed payload uses hex-encoding for the body so that the entire
  signed string is ASCII and unambiguous.
