import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { isHelpRequestErrorCode, type HelpRequestErrorCode } from "@/lib/contracts/help-requests";
import type { Database } from "@/lib/supabase/database.types";

import { normalizarCausa, registrarFalhaDeRepositorio } from "./repository-error";

type Client = SupabaseClient<Database>;

/**
 * Pedidos de ajuda (PRO-8). Toda escrita e RPC `SECURITY DEFINER`; a tabela
 * nao tem policy de escrita. O texto do pedido nunca entra em log: a falha
 * inesperada registra so `code`/`message`/`hint` do PostgREST.
 */

/** Recusa de regra do banco. Esperada: nao loga. */
export class HelpRequestRuleError extends Error {
  constructor(public readonly code: HelpRequestErrorCode) {
    super(code);
    this.name = "HelpRequestRuleError";
  }
}

export class HelpRequestRepositoryError extends Error {
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio de pedidos: ${operation}.`);
    this.name = "HelpRequestRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("pedidos", operation, normalizada);
  }
}

function fail(operation: string, error: { code?: string; message?: string }): never {
  if (isHelpRequestErrorCode(error.message)) throw new HelpRequestRuleError(error.message);
  throw new HelpRequestRepositoryError(operation, error);
}

export async function createHelpRequest(
  client: Client,
  input: { connectionId: string; body: string; idempotencyKey: string },
) {
  const { data, error } = await client.rpc("create_help_request", {
    p_connection_id: input.connectionId,
    p_body: input.body,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) fail("create_help_request", error);
  return data as string;
}

export async function transitionHelpRequest(client: Client, id: string, action: string) {
  const { data, error } = await client.rpc("transition_help_request", {
    p_request_id: id,
    p_action: action,
  });
  if (error) fail("transition_help_request", error);
  return data as string;
}

export async function listMyHelpRequests(client: Client) {
  const { data, error } = await client.rpc("list_my_help_requests");
  if (error) fail("list_my_help_requests", error);
  return data ?? [];
}

export async function listMyHelpRequestTargets(client: Client) {
  const { data, error } = await client.rpc("list_my_help_request_targets");
  if (error) fail("list_my_help_request_targets", error);
  return data ?? [];
}
