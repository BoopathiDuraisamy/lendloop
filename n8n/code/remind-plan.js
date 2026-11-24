// One overdue reminder per loan, fanned out to private channels only (email,
// slack, mock). Never to Discord: a public channel must not shame borrowers.
// pairedItem links each output back to its loan for later $('Plan deliveries').item lookups.
const channels = enabledChannels().filter((c) => c !== 'discord');

return $input.all().flatMap((input, i) => {
  const loan = input.json;
  const plural = loan.daysOverdue === 1 ? 'day' : 'days';
  const ref = { loanId: loan.loanId, reminderKey: loan.reminderKey };
  const subject = `LendLoop · Reminder: please return the ${loan.toolName}`;
  const body = `Friendly reminder: "${loan.toolName}" was due back on ${loan.endDate} (${loan.daysOverdue} ${plural} ago). Please return it to your neighbor, or reach out to them if you need more time.`;

  if (!channels.length) return [{ json: { ref, channel: 'none', problem: 'no private channel enabled for reminders' }, pairedItem: i }];

  return channels.map((channel) => ({
    pairedItem: i,
    json: {
      ref,
      channel,
      to: loan.borrower.email,
      subject,
      text: `Hi ${loan.borrower.name},\n\n${body}\n\n— LendLoop`,
      slackText: `*${subject.replace('LendLoop · ', '')}*\n${body}`,
      problem: loan.borrower.email ? null : 'borrower has no email on file',
    },
  }));
});
