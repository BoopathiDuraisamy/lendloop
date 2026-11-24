// MOCK channel (LENDLOOP_NOTIFY_MODE=mock): log instead of sending. Runs once per item.
const m = $json;
console.log(`[mock-email] to=${maskEmail(m.to)} subject="${m.subject}"`);
rememberDelivered(m.ref);
return { json: { ...m.ref, status: 'sent', channel: 'mock-email' } };
