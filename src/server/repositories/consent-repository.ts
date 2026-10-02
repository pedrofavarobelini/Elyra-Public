import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import {
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

type Client = SupabaseClient<Database>;

export type ConsentEventRow =
  Database["public"]["Tables"]["consent_events"]["Row"];

const CONSENT_FIELDS =
  "id, purpose, document_version, event_type, granted_event_id, occurred_at, expires_at" as const;

export class ConsentRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de consentimento: ${operation}.`);
    this.name = "ConsentRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("identidade", operation, normalizada);
  }
}

/**
 * O log inteiro da pessoa, em ordem cronologica.
 *
 * Sem filtro por finalidade e sem paginacao: o log de consentimento de um
 * titular tem dezenas de linhas na vida inteira da conta, e recortar a historia
 * para exibi-la seria contar parte dela. Se um dia crescer a ponto de precisar
 * de pagina, isso vira decisao explicita — e nao um `limit` esquecido aqui.
 *
 * A RLS restringe ao proprio `auth.uid()`: nao ha filtro de usuario neste
 * codigo porque nao e este codigo que garante o isolamento.
 */
export async function findConsentEvents(client: Client) {
  const { data, error } = await client
    .from("consent_events")
    .select(CONSENT_FIELDS)
    .order("occurred_at", { ascending: true })
    .order("id", { ascending: true });
  if (error) throw new ConsentRepositoryError("find_consent_events", error);
  return data satisfies Pick<
    ConsentEventRow,
    | "id"
    | "purpose"
    | "document_version"
    | "event_type"
    | "granted_event_id"
    | "occurred_at"
    | "expires_at"
  >[];
}
