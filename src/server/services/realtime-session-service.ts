import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import {
  SESSION_MEDIA_DENIALS,
  SESSION_MEDIA_DENIAL_COPY,
  sessionMediaEventSchema,
  sessionMediaRequestSchema,
  type SessionMediaDenial,
  type SessionMediaGrant,
} from "@/lib/contracts/professional-sessions";
import type { Database } from "@/lib/supabase/database.types";
import { readRealtimeConfig, type RealtimeConfig } from "@/server/realtime/config";
import { realtimeE2EEKey, realtimeIdentity, realtimeRoomName } from "@/server/realtime/derive";
import {
  RealtimeProviderError,
  createLiveKitProvider,
  type RealtimeSessionProvider,
} from "@/server/realtime/provider";
import {
  SessionRuleError,
  authorizeSessionMedia,
  listOpenSessionIdsBy,
  readSessionMediaGeneration,
  readSessionParties,
  recordSessionMediaEvent,
} from "@/server/repositories/professional-session-repository";

type Client = SupabaseClient<Database>;

const idSchema = z.string().uuid("Sessão inválida.");

/** TTL do token do provider: so para ENTRAR; reconexao completa volta aqui. */
export const REALTIME_TOKEN_TTL_SECONDS = 120;
/** Revalidacao durante a chamada: proporcional, sem polling agressivo. */
export const REALTIME_HEARTBEAT_SECONDS = 30;
/** Quantas geracoes anteriores a varredura confere (bumps em sequencia). */
const SWEEP_DEPTH = 5;

/** Provider indisponivel ou nao configurado: a UI diz, sem 500 nem tela branca. */
export class RealtimeUnavailableError extends Error {
  constructor(public readonly reason: "not_configured" | "provider_error") {
    super(`realtime unavailable: ${reason}`);
    this.name = "RealtimeUnavailableError";
  }
}

type Dependencies = {
  config: RealtimeConfig | null;
  provider: RealtimeSessionProvider | null;
};

function defaultDependencies(): Dependencies {
  const config = readRealtimeConfig();
  return { config, provider: config ? createLiveKitProvider(config) : null };
}

/** Log so com metadado: id interno, classe de erro. Nunca token, chave, SDP. */
function logRealtime(event: string, fields: Record<string, string | number | null>) {
  console.info("elyra.realtime", { event, ...fields });
}

function roomsToSweep(config: RealtimeConfig, sessionId: string, generation: number, includeCurrent: boolean) {
  const rooms: string[] = [];
  const last = includeCurrent ? generation : generation - 1;
  for (let value = Math.max(1, generation - SWEEP_DEPTH); value <= last; value += 1) {
    rooms.push(realtimeRoomName(config.roomSalt, sessionId, value));
  }
  return rooms;
}

async function sweep(deps: Dependencies, sessionId: string, generation: number, includeCurrent: boolean) {
  if (!deps.config || !deps.provider) return;
  try {
    const closed = await deps.provider.closeRooms(roomsToSweep(deps.config, sessionId, generation, includeCurrent));
    if (closed > 0) logRealtime("rooms_closed", { session: sessionId, count: closed });
  } catch (error) {
    // A recusa no banco ja vale; a sala sobra ate o proximo heartbeat/varredura.
    logRealtime("sweep_failed", {
      session: sessionId,
      kind: error instanceof RealtimeProviderError ? error.kind : "unknown",
    });
  }
}

function isDenial(value: string): value is SessionMediaDenial {
  return (SESSION_MEDIA_DENIALS as readonly string[]).includes(value);
}

/**
 * Autoriza (ou recusa) midia para a sessao. Toda chamada revalida no banco:
 * auth, participante, presenca, janela, horario confirmado, vinculo ativo e
 * verificacao vigente. UUID nunca autoriza nada sozinho.
 */
export async function authorizeSessionMediaFor(
  client: Client,
  userId: string,
  rawId: string,
  raw: unknown,
  deps: Dependencies = defaultDependencies(),
): Promise<SessionMediaGrant> {
  const id = idSchema.parse(rawId);
  const { purpose } = sessionMediaRequestSchema.parse(raw);
  if (!deps.config || !deps.provider) throw new RealtimeUnavailableError("not_configured");

  const row = await authorizeSessionMedia(client, id, purpose);
  if (!row || row.outcome === "not_found") throw new SessionRuleError("session_not_found");

  if (row.outcome !== "authorized") {
    const reason: SessionMediaDenial = isDenial(row.outcome) ? row.outcome : "session_closed";
    // Recusa que vale para os DOIS lados: a sala da geracao atual tambem cai.
    if (reason !== "not_present") await sweep(deps, id, row.generation, true);
    logRealtime("denied", { session: id, reason });
    return { status: "denied", reason, message: SESSION_MEDIA_DENIAL_COPY[reason] };
  }

  // Salas de geracoes anteriores nunca sobrevivem a uma autorizacao nova.
  await sweep(deps, id, row.generation, false);

  if (purpose === "heartbeat") {
    return { status: "authorized", generation: row.generation, heartbeatSeconds: REALTIME_HEARTBEAT_SECONDS, join: null };
  }

  const parties = await readSessionParties(client, id);
  if (!parties) throw new SessionRuleError("session_not_found");
  const peerUserId = parties.client_user_id === userId ? parties.professional_user_id : parties.client_user_id;
  const room = realtimeRoomName(deps.config.roomSalt, id, row.generation);
  const identity = realtimeIdentity(deps.config.roomSalt, id, userId);
  try {
    await deps.provider.ensureRoom(room);
    const token = await deps.provider.createAccess({ room, identity, ttlSeconds: REALTIME_TOKEN_TTL_SECONDS });
    logRealtime("authorized", { session: id, participant: identity, generation: row.generation });
    return {
      status: "authorized",
      generation: row.generation,
      heartbeatSeconds: REALTIME_HEARTBEAT_SECONDS,
      join: {
        url: deps.config.url,
        token,
        e2eeKey: realtimeE2EEKey(deps.config.e2eeSecret, id, row.generation),
        identity,
        peerIdentity: realtimeIdentity(deps.config.roomSalt, id, peerUserId),
      },
    };
  } catch (error) {
    logRealtime("provider_error", {
      session: id,
      kind: error instanceof RealtimeProviderError ? error.kind : "unknown",
    });
    throw new RealtimeUnavailableError("provider_error");
  }
}

const EVENT = {
  joined: "REALTIME_JOINED",
  left: "REALTIME_LEFT",
  reconnected: "REALTIME_RECONNECT",
} as const;

export async function recordSessionMediaEventFor(client: Client, rawId: string, raw: unknown) {
  const id = idSchema.parse(rawId);
  const { event } = sessionMediaEventSchema.parse(raw);
  await recordSessionMediaEvent(client, id, EVENT[event]);
  return { id, event };
}

/**
 * Depois de uma acao da Elyra que encerra a midia (concluir, cancelar), apaga
 * na hora as salas da sessao: a revogacao nao espera o proximo heartbeat.
 * Nunca falha a acao que a chamou.
 */
export async function closeSessionMediaAfterAction(
  client: Client,
  sessionId: string,
  deps: Dependencies = defaultDependencies(),
) {
  if (!deps.config || !deps.provider) return;
  try {
    const generation = await readSessionMediaGeneration(client, sessionId);
    if (generation) await sweep(deps, sessionId, generation, true);
  } catch {
    logRealtime("close_after_action_failed", { session: sessionId });
  }
}

/** Vinculo pausado/revogado/encerrado ou horario cancelado: fecha as salas ja. */
export async function closeMediaForAction(
  client: Client,
  filter: { connectionId: string } | { appointmentId: string },
  deps: Dependencies = defaultDependencies(),
) {
  if (!deps.config || !deps.provider) return;
  try {
    for (const id of await listOpenSessionIdsBy(client, filter)) {
      await closeSessionMediaAfterAction(client, id, deps);
    }
  } catch {
    logRealtime("close_for_action_failed", { session: null });
  }
}

/**
 * Pre-call: o servico de chamada responde? So para participante; devolve um
 * booleano (nada de host, versao ou sala). Nao emite token nem toca a trilha.
 */
export async function realtimeAvailabilityFor(
  client: Client,
  rawId: string,
  deps: Dependencies = defaultDependencies(),
) {
  const id = idSchema.parse(rawId);
  const parties = await readSessionParties(client, id);
  if (!parties) throw new SessionRuleError("session_not_found");
  if (!deps.config || !deps.provider) return { available: false };
  try {
    await deps.provider.getRoomState(realtimeRoomName(deps.config.roomSalt, "health", 0));
    return { available: true };
  } catch {
    return { available: false };
  }
}
