// Verify the HMAC signature on the incoming Convex webhook and de-duplicate by eventId.
const item = $input.first().json;
const headers = item.headers || {};
let data;
try {
  data = verifyFromLendLoop(
    item.body && item.body.payload,
    headers['x-lendloop-timestamp'],
    headers['x-lendloop-signature'],
  );
} catch (err) {
  // Do not echo the payload: it may be forged and contains personal data.
  return [{ json: { valid: false, reason: err.message } }];
}

// Convex may retry after a timeout even though we received it. Remember
// delivered eventIds (production executions persist workflow static data).
const store = $getWorkflowStaticData('global');
store.delivered = store.delivered || {};
const duplicate = Boolean(store.delivered[data.eventId]);

return [{ json: { valid: true, duplicate, event: data } }];
