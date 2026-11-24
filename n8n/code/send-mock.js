// MOCK channel: log instead of sending (masked recipient). Runs once per item.
const m = $json;
console.log(`[mock] to=${maskEmail(m.to)} subject="${m.subject}"`);
rememberDelivered(m.ref);
return { json: { ...m.ref, status: 'sent', channel: 'mock' } };
