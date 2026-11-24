// A channel couldn't deliver this item (no email, not in Slack, API/SMTP error
// after retries). Reported as "failed" for that channel so it's visible on the loan.
const p = $('Plan deliveries').item.json;
const err = $json.error;
const detail =
  $json.problem || p.problem || (err && (err.message || err.description)) || (typeof err === 'string' ? err : 'send failed');
return { json: { ...p.ref, status: 'failed', channel: p.channel, detail: String(detail).slice(0, 250) } };
