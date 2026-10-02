import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildConsentHistory,
  consentEventSchema,
  hasActiveTermsGrant,
  type ConsentEvent,
  type ConsentHistory,
} from "@/lib/contracts/consent";
import type { Database } from "@/lib/supabase/database.types";
import { findConsentEvents } from "@/server/repositories/consent-repository";

type Client = SupabaseClient<Database>;


export async function getConsentHistory(client: Client): Promise<ConsentHistory> {
  const rows = await findConsentEvents(client);

  const events: ConsentEvent[] = rows.map((row) =>
    consentEventSchema.parse({
      id: row.id,
      purpose: row.purpose,
      documentVersion: row.document_version,
      eventType: row.event_type,
      occurredAt: row.occurred_at,
      grantedEventId: row.granted_event_id,
      expiresAt: row.expires_at,
    }),
  );

  return buildConsentHistory(events);
}

/**
 * A pergunta do portao: esta pessoa aceitou os termos?
 *
 * Reusa a mesma leitura e a **mesma derivacao** do historico, em vez de uma
 * segunda consulta com regra propria. Duas implementacoes da pergunta "esta
 * vigente?" divergem no primeiro caso de borda — e o caso de borda aqui decide
 * acesso.
 *
 * O custo e uma consulta por render de layout autenticado. O log de um titular
 * tem dezenas de linhas na vida inteira da conta, e o layout ja faz meia duzia
 * de leituras em paralelo: esta entra junto, sem round trip adicional.
 */
export async function hasActiveTermsConsent(client: Client): Promise<boolean> {
  return hasActiveTermsGrant(await getConsentHistory(client));
}
