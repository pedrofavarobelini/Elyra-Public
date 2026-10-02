import "server-only";

import { AccessToken, RoomServiceClient, TrackSource } from "livekit-server-sdk";

import type { RealtimeConfig } from "./config";

/**
 * Fronteira servidor <-> provider de midia (ADR-0025, D1). O resto da Elyra
 * fala com esta interface; so este arquivo importa `livekit-server-sdk`.
 *
 * O provider guarda estado de MIDIA; nunca decide acesso. Quem decide e o
 * banco (`authorize_professional_session_media`), antes de cada emissao.
 */
export interface RealtimeSessionProvider {
  /** Token curto, uma sala, uma identidade, so camera e microfone. */
  createAccess(input: { room: string; identity: string; ttlSeconds: number }): Promise<string>;
  /** Sala criada pelo servidor (o provider local roda com `auto_create=false`). */
  ensureRoom(room: string): Promise<void>;
  /** Apaga as salas existentes entre as indicadas (revogacao forte). */
  closeRooms(rooms: readonly string[]): Promise<number>;
  removeParticipant(room: string, identity: string): Promise<void>;
  getRoomState(room: string): Promise<{ exists: boolean; participants: number }>;
}

/** Falha do provider, com classe estavel para log (sem mensagem crua). */
export class RealtimeProviderError extends Error {
  constructor(public readonly operation: string, public readonly kind: "unreachable" | "rejected") {
    super(`realtime provider ${operation}: ${kind}`);
    this.name = "RealtimeProviderError";
  }
}

export const REALTIME_MAX_PARTICIPANTS = 2;
/** Sala vazia some sozinha; a Elyra recria no proximo `join` autorizado. */
export const REALTIME_EMPTY_TIMEOUT_SECONDS = 120;

function classify(operation: string, error: unknown): RealtimeProviderError {
  const status = (error as { status?: number } | null)?.status;
  return new RealtimeProviderError(operation, typeof status === "number" && status < 500 ? "rejected" : "unreachable");
}

function isNotFound(error: unknown) {
  const value = error as { status?: number; code?: string } | null;
  return value?.status === 404 || value?.code === "not_found";
}

export function createLiveKitProvider(config: RealtimeConfig): RealtimeSessionProvider {
  const rooms = new RoomServiceClient(config.url, config.apiKey, config.apiSecret);

  return {
    async createAccess({ room, identity, ttlSeconds }) {
      const token = new AccessToken(config.apiKey, config.apiSecret, { identity, ttl: ttlSeconds });
      token.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE],
        canSubscribe: true,
        canPublishData: false,
        canUpdateOwnMetadata: false,
      });
      return token.toJwt();
    },

    async ensureRoom(room) {
      try {
        await rooms.createRoom({
          name: room,
          maxParticipants: REALTIME_MAX_PARTICIPANTS,
          emptyTimeout: REALTIME_EMPTY_TIMEOUT_SECONDS,
          departureTimeout: 20,
        });
      } catch (error) {
        throw classify("ensure_room", error);
      }
    },

    async closeRooms(candidates) {
      if (candidates.length === 0) return 0;
      let existing: string[];
      try {
        existing = (await rooms.listRooms([...candidates])).map((room) => room.name);
      } catch (error) {
        throw classify("list_rooms", error);
      }
      for (const name of existing) {
        try {
          await rooms.deleteRoom(name);
        } catch (error) {
          if (!isNotFound(error)) throw classify("delete_room", error);
        }
      }
      return existing.length;
    },

    async removeParticipant(room, identity) {
      try {
        await rooms.removeParticipant(room, identity);
      } catch (error) {
        if (!isNotFound(error)) throw classify("remove_participant", error);
      }
    },

    async getRoomState(room) {
      try {
        const found = await rooms.listRooms([room]);
        return { exists: found.length > 0, participants: found[0]?.numParticipants ?? 0 };
      } catch (error) {
        throw classify("room_state", error);
      }
    },
  };
}
