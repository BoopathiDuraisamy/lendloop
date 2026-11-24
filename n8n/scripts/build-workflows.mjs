// Builds n8n/workflows/*.json from the Code-node sources in n8n/code/.
// Keeping node code in .js files makes it reviewable/lintable; the JSON is what
// gets imported into n8n. Run: node n8n/scripts/build-workflows.mjs
//
// No secrets are ever written into the JSON: Code/HTTP nodes read
// $env.LENDLOOP_HMAC_SECRET and $env.LENDLOOP_CONVEX_SITE_URL at runtime.

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Normalize CRLF so the generated JSON is identical on Windows checkouts.
const read = (file) => readFileSync(join(root, "code", file), "utf8").replace(/\r\n/g, "\n");
const shared = read("_shared.js");
const code = (file, withShared = true) => (withShared ? shared + "\n" : "") + read(file);

// Deterministic UUIDs so regenerating doesn't churn the diff.
const uuid = (seed) => {
  const h = createHash("sha1").update(seed).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};

const ERROR_WORKFLOW_ID = "lendloopErrors01";

const settings = (withErrorWorkflow = true) => ({
  executionOrder: "v1",
  saveDataErrorExecution: "all",
  saveDataSuccessExecution: "all",
  saveManualExecutions: true,
  ...(withErrorWorkflow ? { errorWorkflow: ERROR_WORKFLOW_ID } : {}),
});

const codeNode = (wf, name, file, position, extra = {}) => ({
  id: uuid(`${wf}:${name}`),
  name,
  type: "n8n-nodes-base.code",
  typeVersion: 2,
  position,
  parameters: { jsCode: code(file), ...extra },
});

/** POST a signed envelope ({payload,timestamp,signature} from the previous node) to Convex. */
const signedPost = (wf, name, path, position) => ({
  id: uuid(`${wf}:${name}`),
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position,
  retryOnFail: true,
  maxTries: 4,
  waitBetweenTries: 5000,
  parameters: {
    method: "POST",
    url: `={{ $env.LENDLOOP_CONVEX_SITE_URL }}${path}`,
    sendHeaders: true,
    headerParameters: {
      parameters: [
        { name: "x-lendloop-timestamp", value: "={{ $json.timestamp }}" },
        { name: "x-lendloop-signature", value: "={{ $json.signature }}" },
      ],
    },
    sendBody: true,
    specifyBody: "json",
    jsonBody: "={{ JSON.stringify({ payload: $json.payload }) }}",
    options: { timeout: 15000 },
  },
});

const ifNode = (wf, name, leftValue, position) => ({
  id: uuid(`${wf}:${name}`),
  name,
  type: "n8n-nodes-base.if",
  typeVersion: 2,
  position,
  parameters: {
    conditions: {
      options: { caseSensitive: true, leftValue: "", typeValidation: "strict" },
      conditions: [
        {
          id: uuid(`${wf}:${name}:cond`),
          leftValue,
          rightValue: true,
          operator: { type: "boolean", operation: "true", singleValue: true },
        },
      ],
      combinator: "and",
    },
    options: {},
  },
});

const respond = (wf, name, code, body, position) => ({
  id: uuid(`${wf}:${name}`),
  name,
  type: "n8n-nodes-base.respondToWebhook",
  typeVersion: 1.1,
  position,
  parameters: {
    respondWith: "json",
    responseBody: JSON.stringify(body),
    options: { responseCode: code },
  },
});

const link = (...targets) => ({ main: targets.map((t) => (t ? [t].flat().map((n) => ({ node: n, type: "main", index: 0 })) : [])) });


// Credentials are referenced by fixed id/name only; secrets live in n8n's
// encrypted credential store (see n8n/scripts/credentials.js).
const CREDENTIALS = {
  smtp: { id: "lendloopSmtp0001", name: "LendLoop SMTP" },
  slackApi: { id: "lendloopSlack001", name: "LendLoop Slack bot" },
  discordWebhookApi: { id: "lendloopDiscord1", name: "LendLoop Discord webhook" },
};

/** Call errors go to the node's error output (→ "Mark failed") after retries. */
const resilient = { retryOnFail: true, maxTries: 3, waitBetweenTries: 5000, onError: "continueErrorOutput" };

const slackApi = (wf, name, method, url, extra, position) => ({
  id: uuid(`${wf}:${name}`),
  name,
  type: "n8n-nodes-base.httpRequest",
  typeVersion: 4.2,
  position,
  ...resilient,
  parameters: {
    method,
    url,
    authentication: "predefinedCredentialType",
    nodeCredentialType: "slackApi",
    ...extra,
    options: { timeout: 10000 },
  },
  credentials: { slackApi: CREDENTIALS.slackApi },
});

const channelIs = (wf, channel, position) =>
  ifNode(wf, `${channel[0].toUpperCase()}${channel.slice(1)}?`, `={{ $json.channel === '${channel}' }}`, position);

/**
 * Shared delivery stage after a "Plan deliveries" node that emits one item per
 * channel: {ref, channel, to, subject, text, slackText, discordText, problem}.
 * Every path ends in a {…ref, status, channel, detail?} write-back item, so each
 * channel's outcome is recorded separately in LendLoop.
 */
function delivery(wf, x, y, next) {
  const each = { mode: "runOnceForEachItem" };
  const nodes = [
    ifNode(wf, "Can send?", "={{ !$json.problem }}", [x, y]),
    channelIs(wf, "email", [x + 220, y - 300]),
    channelIs(wf, "slack", [x + 440, y - 100]),
    channelIs(wf, "discord", [x + 660, y + 100]),
    // email
    {
      id: uuid(`${wf}:Send email`),
      name: "Send email",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2.1,
      position: [x + 660, y - 400],
      ...resilient,
      parameters: {
        fromEmail: "={{ $env.LENDLOOP_MAIL_FROM }}",
        toEmail: "={{ $json.to }}",
        subject: "={{ $json.subject }}",
        emailFormat: "text",
        text: "={{ $json.text }}",
        options: { appendAttribution: false },
      },
      credentials: { smtp: CREDENTIALS.smtp },
    },
    // slack: look the person up by email, then DM them from the app
    slackApi(
      wf,
      "Find Slack user",
      "GET",
      "https://slack.com/api/users.lookupByEmail",
      { sendQuery: true, queryParameters: { parameters: [{ name: "email", value: "={{ $json.to }}" }] } },
      [x + 880, y - 200],
    ),
    codeNode(wf, "Slack user found?", "slack-target.js", [x + 1100, y - 200], each),
    ifNode(wf, "In workspace?", "={{ $json.found }}", [x + 1320, y - 200]),
    slackApi(
      wf,
      "Send Slack DM",
      "POST",
      "https://slack.com/api/chat.postMessage",
      {
        sendBody: true,
        specifyBody: "json",
        jsonBody: "={{ JSON.stringify({ channel: $json.slackUser, text: $json.slackText, unfurl_links: false }) }}",
      },
      [x + 1540, y - 260],
    ),
    codeNode(wf, "Slack result", "slack-result.js", [x + 1760, y - 260], each),
    // discord: anonymized post to a channel via webhook credential
    {
      id: uuid(`${wf}:Post to Discord`),
      name: "Post to Discord",
      type: "n8n-nodes-base.discord",
      typeVersion: 2,
      position: [x + 880, y + 100],
      ...resilient,
      parameters: { authentication: "webhook", content: "={{ $json.discordText }}", options: {} },
      credentials: { discordWebhookApi: CREDENTIALS.discordWebhookApi },
    },
    // mock
    codeNode(wf, "Send (mock)", "send-mock.js", [x + 880, y + 300], each),
    codeNode(wf, "Mark sent", "mark-sent.js", [x + 1980, y - 400], each),
    codeNode(wf, "Mark failed", "mark-failed.js", [x + 1980, y + 300], each),
  ];
  const connections = {
    "Can send?": link("Email?", "Mark failed"),
    "Email?": link("Send email", "Slack?"),
    "Slack?": link("Find Slack user", "Discord?"),
    "Discord?": link("Post to Discord", "Send (mock)"),
    "Send email": link("Mark sent", "Mark failed"),
    "Find Slack user": link("Slack user found?", "Mark failed"),
    "Slack user found?": link("In workspace?"),
    "In workspace?": link("Send Slack DM", "Mark failed"),
    "Send Slack DM": link("Slack result", "Mark failed"),
    "Post to Discord": link("Mark sent", "Mark failed"),
    "Slack result": link(next),
    "Send (mock)": link(next),
    "Mark sent": link(next),
    "Mark failed": link(next),
  };
  return { nodes, connections };
}

// ---------------------------------------------------------------- 1. Request notifications
const NOTIFY = "lendloopNotify01";
const notifyDelivery = delivery(NOTIFY, 1320, 300, "Sign write-back");
const notify = {
  id: NOTIFY,
  name: "LendLoop – Request notifications",
  active: false,
  settings: settings(),
  tags: [],
  pinData: {},
  nodes: [
    {
      id: uuid(`${NOTIFY}:Webhook`),
      name: "Convex webhook",
      type: "n8n-nodes-base.webhook",
      typeVersion: 2,
      position: [0, 300],
      webhookId: uuid(`${NOTIFY}:webhookId`),
      parameters: { httpMethod: "POST", path: "lendloop-request-events", responseMode: "responseNode", options: {} },
    },
    codeNode(NOTIFY, "Verify signature", "notify-verify.js", [220, 300]),
    ifNode(NOTIFY, "Signature valid?", "={{ $json.valid }}", [440, 300]),
    respond(NOTIFY, "Reject (401)", 401, { error: "invalid signature" }, [660, 500]),
    {
      id: uuid(`${NOTIFY}:Stop`),
      name: "Flag rejected call",
      type: "n8n-nodes-base.stopAndError",
      typeVersion: 1,
      position: [880, 500],
      parameters: { errorMessage: "={{ 'Rejected webhook call: ' + $('Verify signature').first().json.reason }}" },
    },
    respond(NOTIFY, "Accept (202)", 202, { accepted: true }, [660, 200]),
    ifNode(NOTIFY, "Already delivered?", "={{ $json.duplicate }}", [880, 200]),
    codeNode(NOTIFY, "Plan deliveries", "notify-plan.js", [1100, 300]),
    ...notifyDelivery.nodes,
    codeNode(NOTIFY, "Sign write-back", "sign-writeback.js", [3520, 300]),
    signedPost(NOTIFY, "Confirm to LendLoop", "/n8n/notification-status", [3740, 300]),
  ],
  connections: {
    "Convex webhook": link("Verify signature"),
    "Verify signature": link("Signature valid?"),
    "Signature valid?": link("Accept (202)", "Reject (401)"),
    "Reject (401)": link("Flag rejected call"),
    "Accept (202)": link("Already delivered?"),
    "Already delivered?": link(null, "Plan deliveries"),
    "Plan deliveries": link("Can send?"),
    ...notifyDelivery.connections,
    "Sign write-back": link("Confirm to LendLoop"),
  },
};

// ---------------------------------------------------------------- 2. Overdue reminders
const REMIND = "lendloopRemind01";
const remindDelivery = delivery(REMIND, 1100, 300, "Sign write-back");
const remind = {
  id: REMIND,
  name: "LendLoop – Daily overdue reminders",
  active: false,
  settings: settings(),
  tags: [],
  pinData: {},
  nodes: [
    {
      id: uuid(`${REMIND}:Schedule`),
      name: "Every day 09:00",
      type: "n8n-nodes-base.scheduleTrigger",
      typeVersion: 1.2,
      position: [0, 300],
      parameters: { rule: { interval: [{ field: "cronExpression", expression: "0 9 * * *" }] } },
    },
    {
      // Lets you run it on demand from the editor or `n8n execute --id=lendloopRemind01`.
      id: uuid(`${REMIND}:Manual`),
      name: "Run now (manual)",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 500],
      parameters: {},
    },
    codeNode(REMIND, "Sign request", "remind-sign-fetch.js", [220, 300]),
    signedPost(REMIND, "Fetch overdue loans", "/n8n/overdue-loans", [440, 300]),
    codeNode(REMIND, "Split loans", "remind-split.js", [660, 300]),
    codeNode(REMIND, "Plan deliveries", "remind-plan.js", [880, 300]),
    ...remindDelivery.nodes,
    codeNode(REMIND, "Sign write-back", "sign-writeback.js", [3300, 300]),
    signedPost(REMIND, "Record reminder in LendLoop", "/n8n/reminder-status", [3520, 300]),
  ],
  connections: {
    "Every day 09:00": link("Sign request"),
    "Run now (manual)": link("Sign request"),
    "Sign request": link("Fetch overdue loans"),
    "Fetch overdue loans": link("Split loans"),
    "Split loans": link("Plan deliveries"),
    "Plan deliveries": link("Can send?"),
    ...remindDelivery.connections,
    "Sign write-back": link("Record reminder in LendLoop"),
  },
};

// ---------------------------------------------------------------- 3. Error handler
const errors = {
  id: ERROR_WORKFLOW_ID,
  name: "LendLoop – Error handler",
  active: false,
  settings: settings(false), // must not point at itself
  tags: [],
  pinData: {},
  nodes: [
    {
      id: uuid(`${ERROR_WORKFLOW_ID}:Trigger`),
      name: "On workflow error",
      type: "n8n-nodes-base.errorTrigger",
      typeVersion: 1,
      position: [0, 300],
      parameters: {},
    },
    codeNode(ERROR_WORKFLOW_ID, "Build signed report", "error-report.js", [220, 300]),
    signedPost(ERROR_WORKFLOW_ID, "Report to LendLoop", "/n8n/workflow-error", [440, 300]),
  ],
  connections: {
    "On workflow error": link("Build signed report"),
    "Build signed report": link("Report to LendLoop"),
  },
};

const out = join(root, "workflows");
mkdirSync(out, { recursive: true });
for (const [file, wf] of [
  ["request-notifications.json", notify],
  ["overdue-reminders.json", remind],
  ["error-handler.json", errors],
]) {
  writeFileSync(join(out, file), JSON.stringify(wf, null, 2) + "\n");
  console.log(`wrote workflows/${file}`);
}
