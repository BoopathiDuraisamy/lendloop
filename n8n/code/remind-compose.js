// Build one overdue reminder (runs once per loan). Uses only name, email, tool and due date.
const loan = $json;
const plural = loan.daysOverdue === 1 ? 'day' : 'days';
return {
  json: {
    ref: { loanId: loan.loanId, reminderKey: loan.reminderKey },
    to: loan.borrower.email,
    subject: `LendLoop · Reminder: please return the ${loan.toolName}`,
    text: `Hi ${loan.borrower.name},\n\nFriendly reminder: "${loan.toolName}" was due back on ${loan.endDate} (${loan.daysOverdue} ${plural} ago). Please return it to your neighbor, or reach out to them if you need more time.\n\n— LendLoop`,
    problem: loan.borrower.email ? null : 'borrower has no email on file',
  },
};
