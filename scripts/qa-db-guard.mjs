import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const configPath = resolve(root, "supabase", "config.toml");
const linkedProjectPath = resolve(root, "supabase", ".temp", "project-ref");

function abort(reason) {
  console.error(`QA_DB_GUARD=BLOCKED reason=${reason}`);
  process.exit(1);
}

if (!existsSync(configPath)) abort("missing_supabase_config");

const config = readFileSync(configPath, "utf8");
const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
const apiPort = config.match(/^\[api\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];
const dbPort = config.match(/^\[db\][\s\S]*?^port\s*=\s*(\d+)/m)?.[1];

if (projectId !== "elyra-public-snapshot-local") abort("unexpected_project_id");
if (apiPort !== "54381") abort("unexpected_api_port");
if (dbPort !== "54382") abort("unexpected_db_port");
if (existsSync(linkedProjectPath)) abort("remote_project_link_detected");

const configuredProject = process.env.SUPABASE_PROJECT_ID;
if (configuredProject && configuredProject !== projectId) {
  abort("environment_project_mismatch");
}

for (const [name, raw] of [
  ["NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL],
  ["SUPABASE_DB_URL", process.env.SUPABASE_DB_URL],
]) {
  if (!raw) continue;
  let url;
  try {
    url = new URL(raw);
  } catch {
    abort(`${name.toLowerCase()}_invalid`);
  }
  if (!new Set(["127.0.0.1", "localhost", "::1"]).has(url.hostname)) {
    abort(`${name.toLowerCase()}_not_local`);
  }
  const expectedPort = name === "SUPABASE_DB_URL" ? "54382" : "54381";
  if (url.port !== expectedPort) abort(`${name.toLowerCase()}_unexpected_port`);
}

console.log(
  "QA_DB_GUARD=PASS project=elyra-public-snapshot-local api=127.0.0.1:54381 db=127.0.0.1:54382",
);
