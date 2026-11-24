// Couldn't deliver this item (no email on file, or SMTP failed after retries).
// Reported to LendLoop as "failed" so it's visible on the loan. Runs once per item.
const m = $('Compose message').item.json;
const err = $json.error;
const detail = m.problem || (err && (err.message || err.description)) || (typeof err === 'string' ? err : 'send failed');
return { json: { ...m.ref, status: 'failed', channel: m.problem ? 'none' : 'email', detail: String(detail).slice(0, 250) } };
