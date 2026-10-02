import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  helpRequestActionSchema,
  helpRequestCreateSchema,
  helpRequestSchema,
  helpRequestTargetSchema,
  type HelpRequest,
  type HelpRequestTarget,
} from "@/lib/contracts/help-requests";
import type { Database } from "@/lib/supabase/database.types";
import {
  createHelpRequest,
  listMyHelpRequests,
  listMyHelpRequestTargets,
  transitionHelpRequest,
} from "@/server/repositories/help-request-repository";

type Client = SupabaseClient<Database>;

/**
 * Pedidos de ajuda (PRO-8). UI -> rota -> servico -> repositorio -> RPC.
 * O servico valida forma e traduz linhas; vinculo, verificacao, limite,
 * idempotencia e transicao sao do banco.
 */

export async function getMyHelpRequests(client: Client): Promise<HelpRequest[]> {
  const rows = await listMyHelpRequests(client);
  return rows.map((row) =>
    helpRequestSchema.parse({
      id: row.id,
      connectionId: row.connection_id,
      role: row.role,
      counterpartName: row.counterpart_name,
      status: row.status,
      body: row.body,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
      seenAt: row.seen_at,
      respondedAt: row.responded_at,
      endedAt: row.ended_at,
    }),
  );
}

export async function getMyHelpRequestTargets(client: Client): Promise<HelpRequestTarget[]> {
  const rows = await listMyHelpRequestTargets(client);
  return rows.map((row) =>
    helpRequestTargetSchema.parse({
      connectionId: row.connection_id,
      professionalName: row.professional_name,
      waiting: row.waiting,
    }),
  );
}

export async function sendHelpRequest(client: Client, raw: unknown) {
  const input = helpRequestCreateSchema.parse(raw);
  return { id: await createHelpRequest(client, input) };
}

export async function applyHelpRequestAction(client: Client, id: string, raw: unknown) {
  const { action } = helpRequestActionSchema.parse(raw);
  return { status: await transitionHelpRequest(client, id, action) };
}
