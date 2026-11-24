/**
 * HMAC-SHA256 signing shared by both directions of the n8n integration.
 *
 * Wire format (both directions):
 *   body:    {"payload": "<JSON string>"}
 *   headers: X-LendLoop-Timestamp: <unix seconds>
 *            X-LendLoop-Signature: sha256=<hex(HMAC(secret, `${timestamp}.${payload}`))>
 *
 * Signing the payload *string* (not re-serialized JSON) makes verification
 * byte-exact on both sides, and the timestamp bounds replay to a short window.
 */

export const SIGNATURE_HEADER = "x-lendloop-signature";
export const TIMESTAMP_HEADER = "x-lendloop-timestamp";
export const MAX_SKEW_SECONDS = 300;

const encoder = new TextEncoder();

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function sign(secret: string, payload: string, timestamp = Math.floor(Date.now() / 1000)) {
  const signature = `sha256=${await hmacHex(secret, `${timestamp}.${payload}`)}`;
  return { timestamp: String(timestamp), signature };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verify(
  secret: string,
  payload: string,
  timestampHeader: string | null,
  signatureHeader: string | null,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<VerifyResult> {
  if (!timestampHeader || !signatureHeader) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestampHeader);
  if (!Number.isInteger(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(nowSeconds - ts) > MAX_SKEW_SECONDS) return { ok: false, reason: "stale timestamp" };
  const expected = `sha256=${await hmacHex(secret, `${ts}.${payload}`)}`;
  return timingSafeEqual(expected, signatureHeader.trim())
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
