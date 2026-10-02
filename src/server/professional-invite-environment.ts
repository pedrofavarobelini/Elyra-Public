import "server-only";
import { isLocalSupabase } from "@/server/professional-verification/config";

/** A display hint only. It never chooses a client, URL or invite database. */
export function professionalInviteEnvironment(env: Readonly<Record<string, string | undefined>> = process.env): "local" | "staging" | null {
  if (env.ELYRA_RUNTIME_ENV === "production") return null;
  const local = isLocalSupabase(env.NEXT_PUBLIC_SUPABASE_URL);
  if (local && (env.NODE_ENV !== "production" || env.ELYRA_RUNTIME_ENV === "qa")) return "local";
  return !local && env.ELYRA_RUNTIME_ENV === "staging" ? "staging" : null;
}
