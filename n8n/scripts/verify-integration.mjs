// Reviewer check for the n8n -> Convex integration. Signs requests exactly like
// the n8n Code nodes do (secret read from n8n/.env, never printed) and checks:
//   1. unsigned / forged / stale requests are rejected with 401
//   2. a correctly signed request is accepted (overdue-loans feed)
//   3. a write-back for a loan/key mismatch is rejected (404)
//   4. --writeback: a signed reminder write-back sent twice is applied once
//      (second reply is {duplicate:true}). This marks one overdue loan as
//      reminded for today WITHOUT sending a message, so it's opt-in.
//
//   npm run verify:integration [-- --writeback]

import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync("n8n/.env", "utf8")
    .split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
);
const secret = env.LENDLOOP_HMAC_SECRET;
// From the host, reach a local backend directly instead of via Docker's host alias.
const base = (env.LENDLOOP_CONVEX_SITE_URL || "").replace("host.docker.internal", "127.0.0.1").replace(/\/$/, "");
if (!secret || secret === "change-me" || !base) {
  console.error("Set LENDLOOP_HMAC_SECRET and LENDLOOP_CONVEX_SITE_URL in n8n/.env first.");
  process.exit(1);
}

function sign(obj, { skew = 0, tamper = false } = {}) {
  const payload = JSON.stringify(obj);
  const timestamp = String(Math.floor(Date.now() / 1000) + skew);
  let signature = "sha256=" + createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
  if (tamper) signature = signature.slice(0, -1) + (signature.endsWith("0") ? "1" : "0");
  return { payload, timestamp, signature };
}

async function post(path, obj, opts) {
  const s = sign(obj, opts);
  const res = await fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", "x-lendloop-timestamp": s.timestamp, "x-lendloop-signature": s.signature },
    body: JSON.stringify({ payload: s.payload }),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

let failures = 0;
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
  if (!ok) failures++;
};

console.log(`Convex HTTP endpoint: ${base}\n`);

const unsigned = await fetch(base + "/n8n/overdue-loans", { method: "POST", body: JSON.stringify({ payload: "{}" }) });
check("unsigned request rejected", unsigned.status === 401, `HTTP ${unsigned.status}`);

const forged = await post("/n8n/overdue-loans", {}, { tamper: true });
check("forged signature rejected", forged.status === 401, `HTTP ${forged.status}`);

const stale = await post("/n8n/overdue-loans", {}, { skew: -600 });
check("stale timestamp (10 min old) rejected", stale.status === 401, `HTTP ${stale.status}`);

const feed = await post("/n8n/overdue-loans", { requestedAt: new Date().toISOString() });
check("signed request accepted", feed.status === 200 && Array.isArray(feed.body?.loans), `HTTP ${feed.status}, ${feed.body?.loans?.length ?? "?"} overdue loan(s) not yet reminded today`);

const loans = feed.body?.loans ?? [];
if (loans.length) {
  const mismatch = await post("/n8n/reminder-status", {
    loanId: loans[0].loanId,
    reminderKey: "overdue:someOtherLoan:2000-01-01",
    status: "sent",
    channel: "mock",
  });
  check("write-back with mismatched loan/key rejected", mismatch.status === 404, `HTTP ${mismatch.status}`);
}

if (process.argv.includes("--writeback")) {
  if (!loans.length) {
    console.log("SKIP  idempotent write-back (no overdue loan left to remind today)");
  } else {
    const wb = { loanId: loans[0].loanId, reminderKey: loans[0].reminderKey, status: "sent", channel: "mock", detail: "verify-integration" };
    const first = await post("/n8n/reminder-status", wb);
    const second = await post("/n8n/reminder-status", wb);
    check("first write-back applied", first.status === 200 && first.body?.duplicate === false, JSON.stringify(first.body));
    check("retried write-back is a no-op", second.status === 200 && second.body?.duplicate === true, JSON.stringify(second.body));
  }
} else {
  console.log("SKIP  idempotent write-back (run with --writeback; marks one overdue loan as reminded today)");
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
