// Result of chat.postMessage (HTTP 200 with ok:false on errors).
const p = $('Plan deliveries').item.json;
if (!$json.ok) {
  const e = $json.error;
  const code = typeof e === 'string' ? e : (e && (e.message || e.description)) || 'unknown';
  return { json: { ...p.ref, status: 'failed', channel: 'slack', detail: `Slack error: ${code}` } };
}
rememberDelivered(p.ref);
return { json: { ...p.ref, status: 'sent', channel: 'slack' } };
