// MOCK notification channel. Swap the send() body for a real channel (Send Email /
// Slack / Discord node with n8n credentials) in production. Uses only the fields it needs.
const e = $json.event;
const r = e.recipient;

function send(to, text) {
  console.log(`[mock-email] to=${maskEmail(to) ?? '(no email on file)'} :: ${text}`);
}

const dates = `${e.loan.startDate} → ${e.loan.endDate}`;
const lines = {
  requested: `${r.name}, a neighbor asked to borrow your "${e.loan.toolName}" (${dates}). Review it: ${e.link}`,
  cancelled: `${r.name}, a request for your "${e.loan.toolName}" (${dates}) was cancelled.`,
  approved: `${r.name}, good news! Your request for "${e.loan.toolName}" (${dates}) was approved.`,
  declined: `${r.name}, your request for "${e.loan.toolName}" (${dates}) was declined.`,
  returned: `${r.name}, thanks for returning "${e.loan.toolName}"!`,
};

try {
  const text = lines[e.event];
  if (!text) throw new Error(`unknown event type: ${e.event}`);
  if (!r.email) throw new Error('recipient has no email on file');
  send(r.email, text);
} catch (err) {
  return [{ json: { eventId: e.eventId, status: 'failed', channel: 'mock-email', detail: String(err.message).slice(0, 250) } }];
}

// Remember this eventId so a redelivery from Convex is not sent twice (7-day window).
const store = $getWorkflowStaticData('global');
store.delivered = store.delivered || {};
const now = Date.now();
store.delivered[e.eventId] = now;
for (const [k, t] of Object.entries(store.delivered)) if (now - t > 7 * 864e5) delete store.delivered[k];

return [{ json: { eventId: e.eventId, status: 'sent', channel: 'mock-email' } }];
