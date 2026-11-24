// ---- shared helpers (inlined into each Code node by scripts/build-workflows.mjs) ----
// Secrets come from the n8n container environment, never from workflow JSON.
const crypto = require('crypto');

function lendloopSecret() {
  const secret = $env.LENDLOOP_HMAC_SECRET;
  if (!secret) throw new Error('LENDLOOP_HMAC_SECRET is not set in the n8n environment');
  return secret;
}

/** Wrap an object in the signed envelope Convex expects. */
function signForLendLoop(obj) {
  const payload = JSON.stringify(obj);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature =
    'sha256=' + crypto.createHmac('sha256', lendloopSecret()).update(`${timestamp}.${payload}`).digest('hex');
  return { payload, timestamp, signature };
}

/** Verify a signed envelope from Convex. Returns parsed data or throws. */
function verifyFromLendLoop(payload, timestamp, signature, maxSkewSeconds = 300) {
  if (typeof payload !== 'string' || !timestamp || !signature) throw new Error('missing payload or signature headers');
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > maxSkewSeconds) throw new Error('stale timestamp');
  const expected = Buffer.from(
    'sha256=' + crypto.createHmac('sha256', lendloopSecret()).update(`${timestamp}.${payload}`).digest('hex'),
  );
  const given = Buffer.from(String(signature));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new Error('signature mismatch');
  }
  return JSON.parse(payload);
}

/**
 * Enabled delivery channels from LENDLOOP_NOTIFY_CHANNELS (e.g. "email,slack,discord").
 * Falls back to LENDLOOP_NOTIFY_MODE (email|mock) for older configs. Default: mock.
 */
function enabledChannels() {
  const known = ['email', 'slack', 'discord', 'mock'];
  const raw = $env.LENDLOOP_NOTIFY_CHANNELS || ($env.LENDLOOP_NOTIFY_MODE === 'email' ? 'email' : 'mock');
  const list = String(raw).split(',').map((c) => c.trim().toLowerCase()).filter((c) => known.includes(c));
  return list.length ? [...new Set(list)] : ['mock'];
}

/** Remember a delivered request-notification eventId (7 days) so a Convex redelivery isn't sent twice. */
function rememberDelivered(ref) {
  if (!ref || !ref.eventId) return;
  const store = $getWorkflowStaticData('global');
  store.delivered = store.delivered || {};
  const now = Date.now();
  store.delivered[ref.eventId] = now;
  for (const [k, t] of Object.entries(store.delivered)) if (now - t > 7 * 864e5) delete store.delivered[k];
}

/** Mask an email for logs: jane.doe@example.com -> j***@example.com */
function maskEmail(email) {
  if (!email) return '(no email on file)';
  const [user, domain] = String(email).split('@');
  return `${user.slice(0, 1)}***@${domain}`;
}
// ---- end shared helpers ----
