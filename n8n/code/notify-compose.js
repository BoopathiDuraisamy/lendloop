// Build the notification (recipient, subject, text) from the minimal payload.
// `ref` is what the write-back needs; `problem` marks it undeliverable.
const e = $json.event;
const r = e.recipient;
const tool = e.loan.toolName;
const dates = `${e.loan.startDate} → ${e.loan.endDate}`;

const templates = {
  requested: [`New request for your ${tool}`, `Hi ${r.name},\n\nA neighbor asked to borrow your "${tool}" for ${dates}.\n\nApprove or decline it here: ${e.link}`],
  cancelled: [`Request for your ${tool} was cancelled`, `Hi ${r.name},\n\nA request to borrow your "${tool}" (${dates}) was cancelled. No action needed.`],
  approved: [`Approved: ${tool}`, `Hi ${r.name},\n\nGood news! Your request to borrow "${tool}" for ${dates} was approved.\n\nDetails: ${e.link}`],
  declined: [`Request declined: ${tool}`, `Hi ${r.name},\n\nYour request to borrow "${tool}" for ${dates} was declined. Other neighbors may have something similar: ${e.link}`],
  returned: [`Thanks for returning the ${tool}`, `Hi ${r.name},\n\nThe lender confirmed "${tool}" is back. Thanks for being a great neighbor!`],
};

const t = templates[e.event];
const problem = !t ? `unknown event type: ${e.event}` : !r.email ? 'recipient has no email on file' : null;
return [{
  json: {
    ref: { eventId: e.eventId },
    to: r.email,
    subject: t ? `LendLoop · ${t[0]}` : '',
    text: t ? `${t[1]}\n\n— LendLoop\nYou're receiving this because you use LendLoop.` : '',
    problem,
  },
}];
