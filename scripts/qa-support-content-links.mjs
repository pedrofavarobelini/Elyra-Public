
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parseContentFile } from "../src/lib/support-content/content-model.ts";
import { matchAllowedSource } from "../src/lib/support-content/policy.ts";

const dir = join("content", "support");
const files = readdirSync(dir).filter((name) => name.endsWith(".md") && name !== "README.md");
let broken = 0;

async function check(url) {
  let current = url;
  for (let hop = 0; hop <= 3; hop += 1) {
    if (!matchAllowedSource(current).ok) return `REDIRECT_OUTSIDE_ALLOWLIST ${current}`;
    let response;
    try {
      response = await fetch(current, { method: "HEAD", redirect: "manual", signal: AbortSignal.timeout(10_000) });
      if (response.status === 405 || response.status === 403) {
        response = await fetch(current, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(10_000) });
        await response.body?.cancel();
      }
    } catch (error) {
      return `UNREACHABLE ${error?.name ?? "erro"}`;
    }
    if (response.status >= 300 && response.status < 400 && response.headers.get("location")) {
      current = new URL(response.headers.get("location"), current).toString();
      continue;
    }
    return response.ok ? null : `HTTP_${response.status}`;
  }
  return "TOO_MANY_REDIRECTS";
}

for (const file of files.sort()) {
  const result = parseContentFile(file, readFileSync(join(dir, file), "utf8"));
  const url = result.item?.originalUrl;
  if (!url) continue;
  const problem = await check(url);
  if (problem) broken += 1;
  console.log(`${problem ? "FAIL" : "PASS"} ${result.item.slug} ${problem ?? ""}`.trim());
}
console.log(`SUPPORT_CONTENT_LINKS=${broken ? "FAIL" : "PASS"} checked=${files.length} broken=${broken}`);
process.exit(broken ? 1 : 0);
