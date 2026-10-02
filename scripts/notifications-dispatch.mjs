
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const secret = process.env.ELYRA_DISPATCH_SECRET?.trim() ?? "";
const base = (process.env.ELYRA_PUBLIC_APP_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");

function fail(message, hint) {
  console.error(`NOTIFICATIONS_DISPATCH=FAIL ${message}`);
  if (hint) console.error(`  -> ${hint}`);
  process.exit(1);
}

if (secret.length < 32) {
  fail(
    "reason=secret_missing",
    "defina ELYRA_DISPATCH_SECRET (32+ caracteres) no .env.local e reinicie a Elyra",
  );
}

let url;
try {
  url = new URL(`${base}/api/internal/notifications/dispatch`);
} catch {
  fail("reason=app_url_invalid", "confira ELYRA_PUBLIC_APP_URL");
}
const local = url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
if (!local && url.protocol !== "https:") {
  fail("reason=insecure_target", "use http://localhost ou https");
}

let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(120_000),
  });
} catch {
  fail("reason=app_unreachable", "a Elyra esta no ar? (npm run demo)");
}

if (response.status === 404) {
  fail("reason=route_refused", "segredo diferente do que a Elyra carregou? reinicie com npm run demo:stop / npm run demo");
}
const payload = await response.json().catch(() => null);
const data = payload?.data;
if (!data) fail(`reason=http_${response.status}`);

if (data.status === "unavailable") {
  fail(`reason=${data.reason}`, "confira ELYRA_EMAIL_TRANSPORT, ELYRA_PUBLIC_APP_URL e SUPABASE_SERVICE_ROLE_KEY");
}

console.log(
  `NOTIFICATIONS_DISPATCH=${data.status.toUpperCase()} provider=${data.transport} ` +
    `selected=${data.selected} delivered=${data.delivered} suppressed=${data.suppressed} failed=${data.failed}`,
);
process.exit(data.status === "failed" ? 1 : 0);
