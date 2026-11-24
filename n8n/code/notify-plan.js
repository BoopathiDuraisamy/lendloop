// Build the message once, then emit one item per enabled channel (email, slack,
// discord, mock). Each item carries `ref` (for the write-back) and `channel`.
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

// Discord is a shared channel: anonymized feed (tool + dates only), and only
// for events worth announcing. No names, emails, declines or cancellations.
const feed = {
  requested: `📦 Someone asked to borrow a **${tool}** (${dates}).`,
  approved: `🤝 A **${tool}** is being lent out (${dates}).`,
  returned: `✅ A **${tool}** was returned. Thanks, neighbors!`,
};

const t = templates[e.event];
const ref = { eventId: e.eventId };
if (!t) return [{ json: { ref, channel: 'none', problem: `unknown event type: ${e.event}` }, pairedItem: 0 }];

const items = [];
for (const channel of enabledChannels()) {
  if (channel === 'discord') {
    if (feed[e.event]) items.push({ json: { ref, channel, discordText: feed[e.event] }, pairedItem: 0 });
    continue;
  }
  items.push({
    pairedItem: 0,
    json: {
      ref,
      channel,
      to: r.email,
      subject: `LendLoop · ${t[0]}`,
      text: `${t[1]}\n\n— LendLoop\nYou're receiving this because you use LendLoop.`,
      slackText: `*${t[0]}*\n${t[1].replace(/^Hi [^\n]*\n\n/, '')}`,
      problem: r.email ? null : 'recipient has no email on file',
    },
  });
}
return items.length ? items : [{ json: { ref, channel: 'none', problem: 'no channel applies to this event' }, pairedItem: 0 }];
