import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";

/**
 * Cliente `service_role` — superficie minima e nominal (ADR-0022, ADR-0023).
 *
 * ## Quem pode usar
 *
 * Exatamente tres chamadores, e nenhum deles atende leitura de produto:
 *
 * 1. `recovery-delivery-service` — `auth.admin.generateLink({ type: "recovery" })`
 *    no modo `ELYRA_RECOVERY_DELIVERY=elyra`. E a unica forma de obter o
 *    `hashed_token` sem que o GoTrue envie o e-mail pelo SMTP dele.
 * 2. `notification-email-dispatcher` — agir por muitos titulares fora de
 *    qualquer sessao: RPCs `*_for` de entrega e leitura do e-mail confirmado.
 * 3. `professional-verification/trusted-store` (ADR-0028) — gravar evidencia
 *    de verificacao e pedir a decisao automatica pelas RPCs `*_for`; o
 *    proprio profissional nao pode, senao aprovaria a si mesmo.
 *
 * Qualquer outro uso e bypass de RLS e fica proibido pela regra do CLAUDE.md
 * ("frontend nunca substitui RLS; sem service_role como atalho de produto").
 * `admin-client-usage.test.ts` falha se um quarto arquivo importar isto.
 *
 * ## Ausencia e estado valido
 *
 * Sem `SUPABASE_SERVICE_ROLE_KEY`, devolve `null`. Os chamadores tratam como
 * "canal indisponivel", nunca como erro de pagina.
 */
export type AdminClient = SupabaseClient<Database>;

export type AdminEnvironment = Readonly<Record<string, string | undefined>>;

export function adminClientConfigured(env: AdminEnvironment = process.env): boolean {
  return Boolean(
    env.NEXT_PUBLIC_SUPABASE_URL?.trim() && env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
  );
}

export function createAdminClient(
  env: AdminEnvironment = process.env,
): AdminClient | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) return null;
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
