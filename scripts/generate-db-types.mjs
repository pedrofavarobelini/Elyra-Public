import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const cli = resolve(
  process.cwd(),
  "node_modules",
  "supabase",
  "dist",
  "supabase.js",
);
const output = resolve(process.cwd(), "src", "lib", "supabase", "database.types.ts");
const result = spawnSync(
  process.execPath,
  [cli, "gen", "types", "typescript", "--local", "--schema", "public,storage"],
  { cwd: process.cwd(), encoding: "utf8", windowsHide: true },
);

if (result.status !== 0 || !result.stdout.includes("export type Database")) {
  console.error("DB_TYPES=BLOCKED reason=generation_failed");
  process.exit(result.status ?? 1);
}

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${result.stdout.trimEnd()}\n`, "utf8");
console.log("DB_TYPES=PASS file=src/lib/supabase/database.types.ts");
