// Restart the Cloudflare quick tunnel, wait for its new public URL, and point
// Convex's N8N_REQUEST_WEBHOOK_URL at it. Quick tunnels are free but not
// permanent: run this whenever notifications fail with network errors.
//
//   npm run tunnel:refresh        (needs Node 22+ for the Convex CLI)

import { execFileSync, execSync } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";

const WEBHOOK_PATH = "/webhook/lendloop-request-events";
const sh = (cmd) => execSync(cmd, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

console.log("Restarting tunnel…");
const since = new Date().toISOString();
sh("docker compose --profile tunnel up -d --force-recreate tunnel");

let url;
for (let i = 0; i < 60 && !url; i++) {
  await sleep(1000);
  const logs = sh(`docker compose logs tunnel --since ${since}`);
  url = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/)?.[0];
}
if (!url) {
  console.error("No tunnel URL after 60s. Check `docker compose logs tunnel`.");
  process.exit(1);
}
console.log(`Tunnel: ${url}`);

// Wait until the URL routes to our proxy (GET on the webhook path is 403 by design).
for (let i = 0; i < 30; i++) {
  try {
    const res = await fetch(url + WEBHOOK_PATH);
    if (res.status === 403 || res.status === 404) break;
  } catch {}
  await sleep(2000);
}

execFileSync(
  process.execPath,
  ["node_modules/convex/bin/main.js", "env", "set", "N8N_REQUEST_WEBHOOK_URL", url + WEBHOOK_PATH],
  { stdio: "inherit" },
);
console.log("Done. New notifications will use the new tunnel.");
