// Send Email succeeded for this item. Runs once per item.
const m = $('Compose message').item.json;
rememberDelivered(m.ref);
return { json: { ...m.ref, status: 'sent', channel: 'email' } };
