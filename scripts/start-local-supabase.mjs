import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve(
  process.cwd(),
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);

const excluded = [
  "realtime",
  "imgproxy",
  "studio",
  "edge-runtime",
  "logflare",
  "vector",
  "supavisor",
  "postgres-meta",
].join(",");

const result = spawnSync(process.execPath, [cli, "start", "-x", excluded], {
  cwd: process.cwd(),
  encoding: "utf8",
  windowsHide: true,
});

if (result.status !== 0) {
  console.error("SUPABASE_START=BLOCKED reason=local_stack_failed");
  process.exit(result.status ?? 1);
}

console.log("SUPABASE_START=PASS output=redacted");
