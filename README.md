# LendLoop

> Borrow what you need. Lend what you don't.

A neighborhood tool-lending board. Neighbors list tools, request to borrow them for a date range, and approve, decline or close loans. n8n handles notifications and daily overdue reminders.

**Stack:** Next.js 16 (App Router) · TypeScript · Clerk (auth) · Convex (data + backend logic) · n8n (workflow automation, Docker) · Tailwind v4

---

## Features

| Area | What you get |
|---|---|
| Public page (`/`) | Tagline, read-only list of tools (**name + category only**), "Sign in to lend or borrow" (Clerk) |
| Browse (`/dashboard`) | All tools with availability (Available / On loan until… / booked ranges), category filter, request form with date range + note |
| My listings | Create, edit, delete your own tools (name, category, condition, description) |
| My requests | Your borrow requests, cancel while pending, overdue warning |
| Incoming requests | Approve / decline requests on your tools, mark loans returned, history |
| Admin | Remove any listing, view all loans (filter by status), toggle **Trusted Lender**, see failed automation runs |
| Automation activity (bonus) | Each loan shows its recent automation events, e.g. "Overdue reminder sent via mock-email · 2 days ago" |

---

## Architecture

```
┌────────────┐  Clerk JWT   ┌──────────────────────────────────────────┐
│  Next.js   │─────────────▶│ Convex                                   │
│  (client)  │◀── realtime ─│  queries / mutations  ← RBAC helpers     │
└─────┬──────┘   queries    │  (convex/lib/auth.ts)                    │
      │ Clerk               │                                          │
      ▼                     │  mutation ─▶ automationEvents (outbox)   │
┌────────────┐              │          └▶ scheduler ─▶ n8n.ts action   │
│   Clerk    │              │                         │ HMAC-signed    │
└────────────┘              │  http.ts  (/n8n/*)  ◀───┼──── signed ────┼──┐
                            └─────────────────────────┼────────────────┘  │
                                                      ▼                   │
                            ┌──────────────────────────────────────────┐  │
                            │ n8n                                      │  │
                            │ 1. Request notifications (Webhook)       │──┤ write-back
                            │ 2. Daily overdue reminders (Schedule)    │──┤ fetch + write-back
                            │ 3. Error handler (Error Trigger)         │──┘ failure report
                            └──────────────────────────────────────────┘
```

### Repository layout

```
convex/
  schema.ts            users, tools, loans, automationEvents
  lib/auth.ts          requireUser / requireAdmin / getActiveTool …  (RBAC)
  lib/hmac.ts          sign/verify (Web Crypto, constant-time compare, replay window)
  lib/notify.ts        enqueueNotification (transactional outbox + idempotency key)
  users.ts tools.ts loans.ts      public API, every function authorizes itself
  n8n.ts               outbound webhook action with retry/backoff
  automation.ts        internal payload builders + idempotent write-back mutations
  http.ts              signed HTTP endpoints for n8n
  seed.ts              dev demo data (internal)
src/
  proxy.ts             Clerk (optimistic route gate for /dashboard)
  app/page.tsx         public page
  app/dashboard/*      browse, listings, requests, incoming, admin
n8n/
  code/*.js            Code-node sources (reviewable, lintable)
  scripts/build-workflows.mjs   generates workflows/*.json from code/
  workflows/*.json     exported workflows (import these)
docker-compose.yml     n8n (+ one-shot importer)
```

### Data model

- **users**: `tokenIdentifier` (from verified JWT), name, email, `role: admin|user`, `trustedLender`
- **tools**: `ownerId`, name, category, condition, description, `removedAt` (soft delete keeps loan history)
- **loans**: tool, owner, borrower, `startDate`/`endDate` (inclusive `YYYY-MM-DD`), `status: pending → approved | declined | cancelled → returned`, `reminderCount`, `lastReminderAt`
- **automationEvents**: `kind` (request_notification / overdue_reminder / workflow_error), `status` (pending / sent / failed / skipped), **unique `idempotencyKey`**, attempts, detail

### Loan rules (enforced server-side)
- You can't borrow your own tool. Dates must be valid, not in the past, and at most 30 days.
- Requests can't overlap an approved booking, and you get only one pending request per tool.
- Approving re-checks overlap and **auto-declines** conflicting pending requests (with notifications).
- Only the lender can mark a loan returned, because they're the one who can attest the tool is back.
- Owners can't delete a listing with an active or upcoming loan. Admin removal is allowed, and the loan stays returnable. Either way, pending requests are cancelled and the borrowers notified.

---

## Roles & access control

RBAC is enforced in Convex functions, not only in the UI:

- Every public function starts with `requireUser(ctx)` / `requireAdmin(ctx)` (`convex/lib/auth.ts`) and resolves the caller from the **verified Clerk JWT** (`ctx.auth.getUserIdentity()`). User ids are never accepted from the client for authorization.
- Ownership checks happen per operation. `tools.update` requires owner. `tools.remove` requires owner or admin. `loans.decide` and `loans.markReturned` require the lender. `loans.cancel` requires the borrower. `loans.listAll`, `users.listForAdmin`, `users.setTrustedLender` and `automation.recentFailures` require admin.
- **Admin is never self-assigned.** It is granted via the `ADMIN_EMAILS` deployment env var (verified email) or the CLI-only internal mutation `users:setRole`.
- Functions n8n uses (`automation.*`) are **internal**. They can't be called from the browser, only through the signed HTTP endpoints.
- Errors are typed `ConvexError({code, message})` (UNAUTHENTICATED / FORBIDDEN / NOT_FOUND / BAD_REQUEST), and the UI shows the message.
- `src/proxy.ts` only redirects signed-out users away from `/dashboard`. It's a UX convenience, not a security boundary.

---

## n8n integration

### Wire format (both directions)

```
POST  body:     {"payload": "<JSON string>"}
      headers:  X-LendLoop-Timestamp: <unix seconds>
                X-LendLoop-Signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<payload>")>
```

The signature covers the exact payload **string**, so neither side has to re-serialize JSON identically. The receiver rejects signatures older than 5 minutes (replay window) and compares in constant time. Invalid calls get a generic `401`.

### Workflow 1 – Request notifications (`n8n/workflows/request-notifications.json`)

1. A Convex mutation (request / approve / decline / cancel / return) writes an `automationEvents` row (key `notify:<loanId>:<event>`) **in the same transaction** and schedules `n8n.deliverRequestEvent`. This is a transactional outbox: no status change without its notification, and no notification for a rolled-back change.
2. The action builds a **minimal payload**: recipient name and email, tool name, dates, status, a link. Other users' ids, notes and descriptions are left out. It signs and POSTs to the n8n webhook, retrying with exponential backoff (5s → 40s, 5 attempts) on network errors, 5xx and 429. A permanent failure is recorded as `failed`, shown on the loan, and listed in Admin.
3. In n8n: **Webhook → Verify signature** (HMAC, timestamp; de-dupes by `eventId` using workflow static data) **→ 202 response → Compose → Send (email or mock) → Sign → POST `/n8n/notification-status`** (retries 4×).
   Invalid signatures get a 401 and the run is marked failed (*Stop and Error*), so the error workflow reports it.

### Workflow 2 – Daily overdue reminders (`n8n/workflows/overdue-reminders.json`)

**Schedule (09:00) → Sign → POST `/n8n/overdue-loans` → split → Compose → Send (email or mock), once per loan → Sign → POST `/n8n/reminder-status`**

- Convex returns only approved loans past `endDate` that have **not already been reminded today**, each with a `reminderKey = overdue:<loanId>:<YYYY-MM-DD>`.
- The write-back is **idempotent on `reminderKey`**. A retried or re-run write-back returns `{duplicate: true}` and does not create a second row or increment `reminderCount`. A `failed` reminder can later be upgraded to `sent`.
- A failed send is written back as `failed` (visible on the loan) and retried on the next run.

### Workflow 3 – Error handler (`n8n/workflows/error-handler.json`)

Both workflows set `settings.errorWorkflow` to it (it must be published as well). An **Error Trigger** catches any failed execution (for example, HTTP retries exhausted or a rejected signature), logs it, and posts a signed report to `/n8n/workflow-error`, which is idempotent on execution id. Failures then show up under **Admin → Automation failures**. Nothing fails silently: Convex-side failures are recorded too, and n8n keeps all failed executions (`saveDataErrorExecution: all`).

### Secrets

- Convex: `N8N_WEBHOOK_SECRET`, `N8N_REQUEST_WEBHOOK_URL` via `npx convex env set`
- n8n: `LENDLOOP_HMAC_SECRET`, `LENDLOOP_CONVEX_SITE_URL` in `n8n/.env` (git-ignored), read via `$env` at runtime
- The exported workflow JSON contains **no secrets or URLs**, only `$env.*` references. Check with `grep -i secret n8n/workflows/*.json`.

---

## Local setup

### Prerequisites
- **Node 22+** (the Convex CLI requires it), npm
- Docker Desktop (for n8n)
- A Clerk account and a Convex account

### 1. Install
```bash
npm install
```

### 2. Clerk
1. Create an application at https://dashboard.clerk.com.
2. Enable the **Convex integration** (Dashboard → Integrations → Convex), or create a JWT template named `convex`.
   No custom claims are needed: the default token only carries the user id, and Convex fetches the
   name and verified email from Clerk's Backend API (`convex/clerk.ts`). This works for Google, GitHub and email sign-ups.
3. Copy the **Frontend API URL / issuer** (e.g. `https://xxx.clerk.accounts.dev`) and your API keys.

### 3. Convex
```bash
npx convex dev            # log in, create a project; writes NEXT_PUBLIC_CONVEX_URL to .env.local
# in another terminal:
npx convex env set CLERK_JWT_ISSUER_DOMAIN https://xxx.clerk.accounts.dev
npx convex env set ADMIN_EMAILS you@example.com
npx convex env set N8N_WEBHOOK_SECRET "$(openssl rand -hex 32)"   # keep this value for n8n
npx convex env set APP_URL http://localhost:3000
npx convex env set CLERK_SECRET_KEY sk_test_...          # same as in .env.local; used to read profiles
```

> **Reaching n8n from Convex:** a Convex **cloud** deployment can't call `localhost:5678`. Choose one:
> - **Local Convex backend** (simplest): `npx convex dev --local` (or choose *local* when prompted). Then
>   `N8N_REQUEST_WEBHOOK_URL=http://localhost:5678/webhook/lendloop-request-events` and n8n's
>   `LENDLOOP_CONVEX_SITE_URL=http://host.docker.internal:3211`.
> - **Convex cloud**: expose n8n with a tunnel (`cloudflared tunnel --url http://localhost:5678` or ngrok) and use
>   that URL. Set `LENDLOOP_CONVEX_SITE_URL=https://<deployment>.convex.site`.
>
> ```bash
> npx convex env set N8N_REQUEST_WEBHOOK_URL http://localhost:5678/webhook/lendloop-request-events
> ```
> Until this is set, notifications are recorded as `skipped` and the app keeps working.

### 4. Next.js env
Add to `.env.local` (see `.env.example`):
```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
```

### 5. n8n
```bash
cp n8n/.env.example n8n/.env        # set N8N_ENCRYPTION_KEY and LENDLOOP_HMAC_SECRET (= Convex N8N_WEBHOOK_SECRET)
docker compose run --rm n8n-import  # imports the 3 workflows (fixed ids, so errorWorkflow links resolve)
docker compose up -d n8n            # editor at http://localhost:5678 (create the owner account on first visit)

# Publish (activate) all three. n8n 2.x only runs an error workflow if it is published too.
docker compose exec n8n n8n publish:workflow --id=lendloopNotify01
docker compose exec n8n n8n publish:workflow --id=lendloopRemind01
docker compose exec n8n n8n publish:workflow --id=lendloopErrors01
docker compose restart n8n
# Note: re-running n8n-import unpublishes workflows, so publish them again afterwards.
```

**Let Convex cloud reach the webhook.** `docker compose --profile tunnel up -d` starts a Cloudflare quick
tunnel (no account needed) in front of an nginx proxy that forwards **only**
`POST /webhook/lendloop-request-events`. The n8n editor and API are never exposed (every other path is 404).
```bash
docker compose --profile tunnel up -d
docker compose logs tunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com'
npx convex env set N8N_REQUEST_WEBHOOK_URL https://<that-host>/webhook/lendloop-request-events
```
A quick-tunnel URL changes whenever the `tunnel` container restarts, and Cloudflare may expire it. Run
`npm run tunnel:refresh` to get a new one and update Convex, or use a named Cloudflare tunnel or n8n Cloud for a stable URL.

**Real email (optional).** Notifications are mock-logged by default. To send real email:
1. `cp n8n/smtp.env.example n8n/smtp.env` and fill in your SMTP login. For Gmail, create an
   [App Password](https://myaccount.google.com/apppasswords) (requires 2-Step Verification).
2. `docker compose run --rm n8n-smtp` stores it as the encrypted n8n credential **LendLoop SMTP**.
   `smtp.env` is git-ignored and only given to this one-shot container. The running n8n never has the
   password in its environment, so workflow code can't read it.
3. In `n8n/.env` set `LENDLOOP_NOTIFY_MODE=email` and `LENDLOOP_MAIL_FROM=LendLoop <you@gmail.com>`,
   then `docker compose up -d n8n`.

Send failures are retried 3× and then written back as `failed`, so the loan shows e.g.
"Notification failed: Invalid login". `n8n-import` creates a placeholder credential so workflows can be
published in mock mode, because n8n won't publish a workflow whose credential is missing.

**Tunnel URL changed / notifications failing with network errors?** Free quick tunnels can expire.
`npm run tunnel:refresh` (Node 22+) restarts the tunnel and updates Convex automatically.

**Run the overdue reminders now** (instead of waiting for 09:00): open the workflow in the editor and click
*Execute workflow* (it has a "Run now" manual trigger), or from the CLI:
```bash
docker compose exec -e N8N_RUNNERS_BROKER_PORT=5690 n8n n8n execute --id=lendloopRemind01
```

### 6. Run
```bash
npm run dev               # http://localhost:3000   (keep `npx convex dev` running)
npx convex run seed:demo  # optional: demo neighbors, tools, a pending request and an overdue loan
```
Sign in with the email from `ADMIN_EMAILS` to see the Admin tab. Use a second account (or an incognito window) to try the borrower flow.

### Scripts
| Command | |
|---|---|
| `npm run dev` | Next.js dev server |
| `npm run dev:convex` | Convex dev (codegen + push on save) |
| `npm run typecheck` / `npm run lint` | checks |
| `npm run tunnel:refresh` | new Cloudflare quick tunnel + update Convex webhook URL |
| `npm run n8n:build` | regenerate `n8n/workflows/*.json` from `n8n/code/*.js` |

---

## Environment variables

| Where | Name | Purpose |
|---|---|---|
| `.env.local` | `NEXT_PUBLIC_CONVEX_URL` | Convex client URL (written by `convex dev`) |
| `.env.local` | `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY` | Clerk |
| Convex env | `CLERK_JWT_ISSUER_DOMAIN` | JWT issuer Convex trusts |
| Convex env | `CLERK_SECRET_KEY` | server-side lookup of the signed-in user's name + verified email |
| Convex env | `ADMIN_EMAILS` | comma-separated emails granted admin on sign-in |
| Convex env | `N8N_WEBHOOK_SECRET` | HMAC secret (shared with n8n) |
| Convex env | `N8N_REQUEST_WEBHOOK_URL` | n8n webhook for request notifications |
| Convex env | `APP_URL` | used for links in notifications |
| `n8n/.env` | `LENDLOOP_HMAC_SECRET` | same value as `N8N_WEBHOOK_SECRET` |
| `n8n/.env` | `LENDLOOP_CONVEX_SITE_URL` | Convex HTTP actions base URL (`…convex.site` or `:3211` locally) |
| `n8n/.env` | `N8N_ENCRYPTION_KEY` | encrypts n8n credentials at rest |
| `n8n/.env` | `LENDLOOP_NOTIFY_MODE` | `mock` (default) or `email` |
| `n8n/.env` | `LENDLOOP_MAIL_FROM` | sender, e.g. `LendLoop <you@gmail.com>` |
| `n8n/smtp.env` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | read only by `n8n-smtp` to create the encrypted credential |

---

## Security & data-minimization decisions

- **Public page shows name + category only.** `tools.listPublic` returns nothing else: no owner, description or availability.
- **Signed-in views show display names, never contact details.** Emails are visible only to admins and to the n8n notification payload for the single recipient.
- **n8n gets the minimum.** One recipient's name and email, the tool name, the dates and the status. No other user ids, notes or descriptions. The overdue feed is the same: borrower name and email, tool, due date.
- **Mock channel masks emails in logs** (`j***@example.com`). Real email uses an n8n SMTP credential (encrypted at rest). The SMTP password is never in workflow JSON or the n8n container's environment.
- **Identity comes from the verified JWT**, and the user row is keyed by `tokenIdentifier`. Name and email are fetched server-to-server from Clerk's Backend API (or taken from token claims if configured), never from client arguments. Admin requires an email in `ADMIN_EMAILS` that Clerk reports as **verified**.
- **HMAC both ways**, with timestamped replay protection, constant-time comparison, a generic 401, a 16 KB body cap and per-field validation on every inbound payload.
- **Idempotency everywhere it matters.** Outbound events are keyed `notify:<loan>:<event>`, and n8n also de-dupes by `eventId`. Reminders are keyed `overdue:<loan>:<date>` and errors `n8n-error:<executionId>`.
- **Soft deletes** keep loan history readable for both parties after a listing is removed.
- **Server-side validation** covers text lengths, enum categories and conditions, date formats and ranges, and overlap checks.

---

## What I'd change for production

- **Email at scale**: switch SMTP from Gmail to a transactional provider (Resend, SES, Postmark) with SPF/DKIM on your domain, and add per-user notification preferences and unsubscribe links.
- **Secrets**: use a secrets manager (Doppler, AWS SM or 1Password) for n8n env and Convex env, rotate the HMAC secret with a dual-key verification window, and use separate secrets per direction and per environment.
- **n8n hardening**: pin the image version, use Postgres instead of SQLite, run queue mode with workers, serve over HTTPS behind a reverse proxy, put SSO on the editor, and keep the webhook path unguessable and IP-allowlisted where possible.
- **Replay protection**: store seen nonces or eventIds server-side (not just a timestamp window), and sign responses too.
- **Clerk webhooks** to sync users and deletions (`user.deleted` → anonymize), instead of lazily upserting on sign-in. Manage roles via Clerk metadata or organizations.
- **Scale**: paginate lists (`usePaginatedQuery`), denormalize availability onto `tools`, run the overdue query as a cursor or batched job, and rate-limit mutations (e.g. `@convex-dev/rate-limiter`).
- **Observability**: alert on the error workflow (Slack or PagerDuty), use a Convex log stream to Datadog or Axiom, and add a dead-letter view with a "retry" button for failed notifications.
- **Time zones**: store a neighborhood time zone and evaluate "overdue" in local time (currently UTC).
- **Tests and CI**: `convex-test` unit tests for RBAC and idempotency, Playwright for the main flows, and lint, typecheck and `n8n:build --check` in CI.
- **Privacy**: a data-retention policy for automation events and loan history, and a data export and delete flow.
