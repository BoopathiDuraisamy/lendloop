// MOCK reminder channel (runs once per overdue loan). Swap the send() body for a
// real channel (Send Email / Slack node with n8n credentials) in production.
// Uses only name, email, tool name and due date.
const loan = $json;

function send(to, text) {
  console.log(`[mock-email] to=${maskEmail(to) ?? '(no email on file)'} :: ${text}`);
}

const plural = loan.daysOverdue === 1 ? 'day' : 'days';
const text = `Hi ${loan.borrower.name}, friendly reminder: "${loan.toolName}" was due back on ${loan.endDate} (${loan.daysOverdue} ${plural} ago). Please return it to your neighbor.`;

try {
  if (!loan.borrower.email) throw new Error('borrower has no email on file');
  send(loan.borrower.email, text);
  return { json: { loanId: loan.loanId, reminderKey: loan.reminderKey, status: 'sent', channel: 'mock-email' } };
} catch (err) {
  // Recorded as "failed" in LendLoop (visible on the loan); retried next run under the same reminderKey.
  return {
    json: { loanId: loan.loanId, reminderKey: loan.reminderKey, status: 'failed', channel: 'mock-email', detail: String(err.message).slice(0, 250) },
  };
}
