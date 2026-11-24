// Sign each write-back body for Convex. Idempotency key (eventId/reminderKey)
// travels inside the payload, so HTTP retries are safe.
return $input.all().map((item) => ({ json: signForLendLoop(item.json) }));
