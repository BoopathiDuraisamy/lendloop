// Result of users.lookupByEmail. Slack answers HTTP 200 with ok:false on errors.
const p = $('Plan deliveries').item.json;
if (!$json.ok || !$json.user || !$json.user.id) {
  const e = $json.error;
  const code = typeof e === 'string' ? e : (e && (e.message || e.description)) || 'unknown';
  const why = code === 'users_not_found' ? 'recipient is not in the Slack workspace' : `Slack lookup failed (${code})`;
  return { json: { found: false, problem: why } };
}
return { json: { found: true, slackUser: $json.user.id, slackText: p.slackText } };
