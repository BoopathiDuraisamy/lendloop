// A channel node finished for this item. Some nodes (e.g. Discord) report their
// own failures as a normal output item with an `error` field instead of using the
// error branch, so check the item itself before recording success. Runs per item.
const p = $('Plan deliveries').item.json;
const err = $json.error;
if (err) {
  const detail = (err && (err.message || err.description)) || (typeof err === 'string' ? err : 'send failed');
  return { json: { ...p.ref, status: 'failed', channel: p.channel, detail: String(detail).slice(0, 250) } };
}
rememberDelivered(p.ref);
return { json: { ...p.ref, status: 'sent', channel: p.channel } };
