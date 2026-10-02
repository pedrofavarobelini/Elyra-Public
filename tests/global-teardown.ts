import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser, isPlaywrightQaEmail } from "./qa-cleanup";

interface QaIdentity {
  userId: string;
}

function normalizeIdentities(raw: unknown): QaIdentity[] {
  if (Array.isArray(raw)) return raw as QaIdentity[];
  return raw && typeof raw === "object" ? [raw as QaIdentity] : [];
}

export default async function globalTeardown() {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const identityFile = resolve(
    process.cwd(),
    "test-results",
    ".auth",
    "identity.json",
  );

  try {
    if (url && serviceRoleKey) {
      const target = new URL(url);
      const isLocalQa = ["127.0.0.1", "localhost"].includes(target.hostname)
        && target.port === "54381";
      if (!isLocalQa) {
        throw new Error("Cleanup Playwright recusado fora do Supabase QA local.");
      }
      const admin = createClient<Database>(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      if (existsSync(identityFile)) {
        const identities = normalizeIdentities(
          JSON.parse(readFileSync(identityFile, "utf8")),
        );
        for (const identity of identities) {
          await cleanupQaUser(admin, identity.userId);
          // A segunda passagem prova que o teardown e seguro e idempotente.
          await cleanupQaUser(admin, identity.userId);
        }
      }

      // O outputDir pode perder o manifesto quando uma execucao e interrompida.
      // A descoberta de fallback continua fail-closed pelo e-mail sintetico
      // estrito e nunca inclui os seeds canonicos ou qualquer dado humano.
      const discoveredIds: string[] = [];
      for (let page = 1; ; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({
          page,
          perPage: 1000,
        });
        if (error) throw error;
        discoveredIds.push(...data.users
          .filter((user) => isPlaywrightQaEmail(user.email ?? ""))
          .map((user) => user.id));
        if (data.users.length < 1000) break;
      }
      for (const userId of new Set(discoveredIds)) {
        await cleanupQaUser(admin, userId);
        await cleanupQaUser(admin, userId);
      }
    }
  } finally {
    rmSync(dirname(identityFile), { recursive: true, force: true });
  }
}
