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


const SMTP_CREDENTIAL = { id: "lendloopSmtp0001", name: "LendLoop SMTP" };

/**
 * Shared delivery stage (after a "Compose message" node that outputs
 * {ref, to, subject, text, problem}). LENDLOOP_NOTIFY_MODE=email sends via
 * SMTP (credential stored in n8n, referenced by id/name only); anything else
 * logs a mock message. Every path ends in a {…ref, status} write-back item.
 */
function delivery(wf, x, y, next) {
  const each = { mode: "runOnceForEachItem" };
  const nodes = [
    ifNode(wf, "Can send?", "={{ !$json.problem }}", [x, y]),
    ifNode(wf, "Email mode?", "={{ $env.LENDLOOP_NOTIFY_MODE === 'email' }}", [x + 220, y - 100]),
    {
      id: uuid(`${wf}:Send email`),
      name: "Send email",
      type: "n8n-nodes-base.emailSend",
      typeVersion: 2.1,
      position: [x + 440, y - 200],
      retryOnFail: true,
      maxTries: 3,
      waitBetweenTries: 5000,
      onError: "continueErrorOutput",
      parameters: {
        fromEmail: "={{ $env.LENDLOOP_MAIL_FROM }}",
        toEmail: "={{ $json.to }}",
        subject: "={{ $json.subject }}",
        emailFormat: "text",
        text: "={{ $json.text }}",
        options: { appendAttribution: false },
      },
      credentials: { smtp: SMTP_CREDENTIAL },
    },
    codeNode(wf, "Send (mock)", "send-mock.js", [x + 440, y], each),
    codeNode(wf, "Mark sent", "mark-sent.js", [x + 660, y - 260], each),
    codeNode(wf, "Mark failed", "mark-failed.js", [x + 660, y + 120], each),
  ];
  const connections = {
    "Can send?": link("Email mode?", "Mark failed"),
    "Email mode?": link("Send email", "Send (mock)"),
    "Send email": link("Mark sent", "Mark failed"),
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
    codeNode(NOTIFY, "Compose message", "notify-compose.js", [1100, 300]),
    ...notifyDelivery.nodes,
    codeNode(NOTIFY, "Sign write-back", "sign-writeback.js", [2200, 300]),
    signedPost(NOTIFY, "Confirm to LendLoop", "/n8n/notification-status", [2420, 300]),
  ],
  connections: {
    "Convex webhook": link("Verify signature"),
    "Verify signature": link("Signature valid?"),
    "Signature valid?": link("Accept (202)", "Reject (401)"),
    "Reject (401)": link("Flag rejected call"),
    "Accept (202)": link("Already delivered?"),
    "Already delivered?": link(null, "Compose message"),
    "Compose message": link("Can send?"),
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
    codeNode(REMIND, "Compose message", "remind-compose.js", [880, 300], { mode: "runOnceForEachItem" }),
    ...remindDelivery.nodes,
    codeNode(REMIND, "Sign write-back", "sign-writeback.js", [1980, 300]),
    signedPost(REMIND, "Record reminder in LendLoop", "/n8n/reminder-status", [2200, 300]),
  ],
  connections: {
    "Every day 09:00": link("Sign request"),
    "Run now (manual)": link("Sign request"),
    "Sign request": link("Fetch overdue loans"),
    "Fetch overdue loans": link("Split loans"),
    "Split loans": link("Compose message"),
    "Compose message": link("Can send?"),
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
