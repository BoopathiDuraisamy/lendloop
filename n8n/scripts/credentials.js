// Create/update LendLoop's n8n credentials from environment variables.
// Runs INSIDE an n8n container (one-shot compose services), never in the
// long-running n8n, so secrets are only ever in n8n's encrypted credential store.
//
//   For each credential:
//     env vars present        -> import (create or overwrite) the real credential
//     missing, not in n8n yet -> import a placeholder (n8n won't publish a workflow
//                                whose credential is missing; placeholder sends fail
//                                visibly as "failed" and are replaced later)
//     missing, already in n8n -> keep the existing one
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");

const env = process.env;
// Marker value for placeholder credentials (not a secret; sends with it fail visibly).
const UNSET = "not-configured";
const defs = [
  {
    id: "lendloopSmtp0001",
    name: "LendLoop SMTP",
    type: "smtp",
    real: env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS,
    data: () => {
      const port = Number(env.SMTP_PORT || 465);
      return {
        host: env.SMTP_HOST,
        port,
        secure: (env.SMTP_SECURE ?? String(port === 465)) === "true",
        user: env.SMTP_USER,
        password: env.SMTP_PASS,
      };
    },
    placeholder: { host: "smtp.invalid", port: 465, secure: true, user: UNSET, password: UNSET },
  },
  {
    id: "lendloopSlack001",
    name: "LendLoop Slack bot",
    type: "slackApi",
    real: env.SLACK_BOT_TOKEN,
    data: () => ({ accessToken: env.SLACK_BOT_TOKEN }),
    placeholder: { accessToken: UNSET },
  },
  {
    id: "lendloopDiscord1",
    name: "LendLoop Discord webhook",
    type: "discordWebhookApi",
    real: env.DISCORD_WEBHOOK_URL,
    data: () => ({ webhookUri: env.DISCORD_WEBHOOK_URL }),
    placeholder: { webhookUri: `https://discord.invalid/api/webhooks/0/${UNSET}` },
  },
];

function exists(id) {
  try {
    execFileSync("n8n", ["export:credentials", `--id=${id}`, "--output=/tmp/exists.json"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  } finally {
    fs.rmSync("/tmp/exists.json", { force: true });
  }
}

const toImport = [];
for (const d of defs) {
  if (d.real) {
    toImport.push({ id: d.id, name: d.name, type: d.type, data: d.data() });
    console.log(`${d.name}: importing configured credential`);
  } else if (!exists(d.id)) {
    toImport.push({ id: d.id, name: d.name, type: d.type, data: d.placeholder });
    console.log(`${d.name}: not configured, creating placeholder`);
  } else {
    console.log(`${d.name}: not configured here, keeping existing credential`);
  }
}

if (toImport.length) {
  const file = "/tmp/lendloop-credentials.json";
  fs.writeFileSync(file, JSON.stringify(toImport), { mode: 0o600 });
  try {
    execFileSync("n8n", ["import:credentials", `--input=${file}`], { stdio: "inherit" });
  } finally {
    fs.rmSync(file, { force: true });
  }
}
