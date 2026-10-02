import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/server/repositories/professional-session-repository", () => ({
  SessionRuleError: class SessionRuleError extends Error {
    constructor(public readonly code: string) {
      super(code);
    }
  },
  authorizeSessionMedia: vi.fn(),
  readSessionMediaGeneration: vi.fn(),
  readSessionParties: vi.fn(),
  recordSessionMediaEvent: vi.fn(),
  listOpenSessionIdsBy: vi.fn(),
}));

import type { Database } from "@/lib/supabase/database.types";
import * as repository from "@/server/repositories/professional-session-repository";
import {
  REALTIME_HEARTBEAT_SECONDS,
  REALTIME_TOKEN_TTL_SECONDS,
  RealtimeUnavailableError,
  authorizeSessionMediaFor,
  closeSessionMediaAfterAction,
  recordSessionMediaEventFor,
} from "@/server/services/realtime-session-service";

import { readRealtimeConfig, realtimePublicOrigin, type RealtimeConfig } from "./config";
import { realtimeE2EEKey, realtimeIdentity, realtimeRoomName } from "./derive";
import { RealtimeProviderError, type RealtimeSessionProvider } from "./provider";

const SESSION = "29710000-0000-4000-8000-0000000000aa";
const OTHER_SESSION = "29710000-0000-4000-8000-0000000000bb";
const CLIENT = "29710000-0000-4000-8000-000000000001";
const PRO = "29710000-0000-4000-8000-000000000011";
const config: RealtimeConfig = {
  url: "ws://localhost:7880",
  apiKey: "elyra-local-test",
  apiSecret: "s".repeat(43),
  roomSalt: "r".repeat(43),
  e2eeSecret: "e".repeat(43),
};
const client = {} as SupabaseClient<Database>;

function fakeProvider(overrides: Partial<RealtimeSessionProvider> = {}) {
  const provider = {
    createAccess: vi.fn(async () => "jwt.token.value"),
    ensureRoom: vi.fn(async () => undefined),
    closeRooms: vi.fn(async (rooms: readonly string[]) => rooms.length),
    removeParticipant: vi.fn(async () => undefined),
    getRoomState: vi.fn(async () => ({ exists: true, participants: 1 })),
    ...overrides,
  };
  return provider;
}

function authorizeRow(outcome: string, generation = 3) {
  vi.mocked(repository.authorizeSessionMedia).mockResolvedValue({
    outcome,
    role: "client",
    generation,
    closes_at: new Date().toISOString(),
  });
}

let logs: unknown[][] = [];
beforeEach(() => {
  logs = [];
  vi.spyOn(console, "info").mockImplementation((...args) => void logs.push(args));
  vi.mocked(repository.readSessionParties).mockResolvedValue({ client_user_id: CLIENT, professional_user_id: PRO });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(repository.authorizeSessionMedia).mockReset();
});

describe("configuracao do provider", () => {
  const complete = {
    LIVEKIT_URL: "ws://localhost:7880",
    LIVEKIT_API_KEY: "key",
    LIVEKIT_API_SECRET: "x".repeat(32),
    REALTIME_ROOM_SALT: "y".repeat(32),
    REALTIME_E2EE_SECRET: "z".repeat(32),
  };

  it("completa e local: configurado", () => {
    expect(readRealtimeConfig(complete)?.url).toBe("ws://localhost:7880");
  });

  it("segredo curto ou ausente = indisponivel (nunca tenta sem segredo)", () => {
    expect(readRealtimeConfig({ ...complete, LIVEKIT_API_SECRET: "curto" })).toBeNull();
    expect(readRealtimeConfig({ ...complete, REALTIME_E2EE_SECRET: undefined })).toBeNull();
    expect(readRealtimeConfig({ ...complete, REALTIME_ROOM_SALT: "" })).toBeNull();
    expect(readRealtimeConfig({ ...complete, LIVEKIT_API_KEY: "" })).toBeNull();
  });

  it("fora de localhost exige wss", () => {
    expect(readRealtimeConfig({ ...complete, LIVEKIT_URL: "ws://midia.exemplo.org" })).toBeNull();
    expect(readRealtimeConfig({ ...complete, LIVEKIT_URL: "wss://midia.exemplo.org" })?.url).toBe("wss://midia.exemplo.org");
    expect(readRealtimeConfig({ ...complete, LIVEKIT_URL: "https://midia.exemplo.org" })).toBeNull();
  });

  it("origem publica nunca carrega segredo", () => {
    expect(realtimePublicOrigin({ LIVEKIT_URL: "wss://midia.exemplo.org/x?y=1" })).toBe("wss://midia.exemplo.org");
  });

  it("nenhum segredo de midia tem prefixo NEXT_PUBLIC em codigo ou exemplo", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(ts|tsx|mjs|js)$/.test(name) && /NEXT_PUBLIC_(LIVEKIT|REALTIME)/.test(readFileSync(path, "utf8"))) {
          offenders.push(path);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    walk(join(process.cwd(), "scripts"));
    const example = readFileSync(join(process.cwd(), ".env.example"), "utf8");
    expect(offenders.filter((path) => !path.endsWith("realtime.test.ts"))).toEqual([]);
    expect(example).not.toMatch(/NEXT_PUBLIC_(LIVEKIT|REALTIME)/);
  });
});

describe("derivacao de sala, identidade e chave", () => {
  it("sala opaca: nao contem sessao nem geracao e muda com a geracao", () => {
    const room = realtimeRoomName(config.roomSalt, SESSION, 1);
    expect(room).not.toContain(SESSION);
    expect(room).toMatch(/^r_[A-Za-z0-9_-]{43}$/);
    expect(realtimeRoomName(config.roomSalt, SESSION, 2)).not.toBe(room);
    expect(realtimeRoomName(config.roomSalt, OTHER_SESSION, 1)).not.toBe(room);
    expect(realtimeRoomName("outro-sal".padEnd(40, "!"), SESSION, 1)).not.toBe(room);
  });

  it("identidade opaca por sessao: sem id do usuario, diferente entre sessoes", () => {
    const identity = realtimeIdentity(config.roomSalt, SESSION, CLIENT);
    expect(identity).not.toContain(CLIENT);
    expect(identity).not.toBe(realtimeIdentity(config.roomSalt, OTHER_SESSION, CLIENT));
    expect(identity).not.toBe(realtimeIdentity(config.roomSalt, SESSION, PRO));
  });

  it("chave E2EE: 32 bytes, nova a cada geracao, separada do nome da sala", () => {
    const key = realtimeE2EEKey(config.e2eeSecret, SESSION, 1);
    expect(Buffer.from(key, "base64url")).toHaveLength(32);
    expect(realtimeE2EEKey(config.e2eeSecret, SESSION, 2)).not.toBe(key);
    expect(realtimeE2EEKey(config.e2eeSecret, OTHER_SESSION, 1)).not.toBe(key);
    expect(realtimeE2EEKey(config.roomSalt, SESSION, 1)).not.toBe(realtimeRoomName(config.roomSalt, SESSION, 1).slice(2));
  });
});

describe("RealtimeSessionService", () => {
  it("sem configuracao: indisponivel antes de tocar o banco", async () => {
    await expect(
      authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config: null, provider: null }),
    ).rejects.toBeInstanceOf(RealtimeUnavailableError);
    expect(repository.authorizeSessionMedia).not.toHaveBeenCalled();
  });

  it("UUID invalido e proposito fora do vocabulario sao recusados", async () => {
    const provider = fakeProvider();
    await expect(authorizeSessionMediaFor(client, CLIENT, "../x", { purpose: "join" }, { config, provider })).rejects.toThrow();
    await expect(authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "admin" }, { config, provider })).rejects.toThrow();
    await expect(
      authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join", room: "r_x" }, { config, provider }),
    ).rejects.toThrow();
  });

  it("not_found vira erro de sessao (404), sem token", async () => {
    authorizeRow("not_found");
    const provider = fakeProvider();
    await expect(authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config, provider })).rejects.toMatchObject({
      code: "session_not_found",
    });
    expect(provider.createAccess).not.toHaveBeenCalled();
  });

  it("join autorizado: sala da geracao, identidade opaca, TTL curto, chave da geracao", async () => {
    authorizeRow("authorized", 3);
    const provider = fakeProvider();
    const grant = await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config, provider });
    const room = realtimeRoomName(config.roomSalt, SESSION, 3);
    expect(provider.ensureRoom).toHaveBeenCalledWith(room);
    expect(provider.createAccess).toHaveBeenCalledWith({
      room,
      identity: realtimeIdentity(config.roomSalt, SESSION, CLIENT),
      ttlSeconds: REALTIME_TOKEN_TTL_SECONDS,
    });
    expect(REALTIME_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(120);
    expect(grant).toMatchObject({
      status: "authorized",
      generation: 3,
      heartbeatSeconds: REALTIME_HEARTBEAT_SECONDS,
      join: {
        url: config.url,
        token: "jwt.token.value",
        e2eeKey: realtimeE2EEKey(config.e2eeSecret, SESSION, 3),
        peerIdentity: realtimeIdentity(config.roomSalt, SESSION, PRO),
      },
    });
    // Geracoes anteriores sao varridas; a atual nao.
    const swept = vi.mocked(provider.closeRooms).mock.calls[0]![0];
    expect(swept).toContain(realtimeRoomName(config.roomSalt, SESSION, 2));
    expect(swept).not.toContain(room);
  });

  it("heartbeat autorizado: sem token nem chave", async () => {
    authorizeRow("authorized", 4);
    const provider = fakeProvider();
    const grant = await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "heartbeat" }, { config, provider });
    expect(grant).toEqual({ status: "authorized", generation: 4, heartbeatSeconds: REALTIME_HEARTBEAT_SECONDS, join: null });
    expect(provider.createAccess).not.toHaveBeenCalled();
  });

  it("vinculo inativo: recusa e derruba a sala ATUAL tambem (vale para os dois lados)", async () => {
    authorizeRow("relationship_inactive", 5);
    const provider = fakeProvider();
    const grant = await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "heartbeat" }, { config, provider });
    expect(grant).toMatchObject({ status: "denied", reason: "relationship_inactive" });
    expect(vi.mocked(provider.closeRooms).mock.calls[0]![0]).toContain(realtimeRoomName(config.roomSalt, SESSION, 5));
    expect(provider.createAccess).not.toHaveBeenCalled();
  });

  it("ainda nao presente: recusa sem derrubar a sala do outro participante", async () => {
    authorizeRow("not_present", 2);
    const provider = fakeProvider();
    const grant = await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config, provider });
    expect(grant).toMatchObject({ status: "denied", reason: "not_present" });
    expect(provider.closeRooms).not.toHaveBeenCalled();
  });

  it("provider fora: indisponivel, sem 500 cru e sem vazar mensagem do provider", async () => {
    authorizeRow("authorized", 1);
    const provider = fakeProvider({
      ensureRoom: vi.fn(async () => {
        throw new RealtimeProviderError("ensure_room", "unreachable");
      }),
    });
    await expect(
      authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config, provider }),
    ).rejects.toBeInstanceOf(RealtimeUnavailableError);
  });

  it("varredura que falha nao muda a recusa (o banco ja decidiu)", async () => {
    authorizeRow("verification_required", 2);
    const provider = fakeProvider({
      closeRooms: vi.fn(async () => {
        throw new RealtimeProviderError("list_rooms", "unreachable");
      }),
    });
    const grant = await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "heartbeat" }, { config, provider });
    expect(grant).toMatchObject({ status: "denied", reason: "verification_required" });
  });

  it("logs nunca contem token, chave E2EE, segredo nem sala", async () => {
    authorizeRow("authorized", 7);
    const provider = fakeProvider();
    await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "join" }, { config, provider });
    authorizeRow("session_closed", 8);
    await authorizeSessionMediaFor(client, CLIENT, SESSION, { purpose: "heartbeat" }, { config, provider });
    const text = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    for (const secret of [
      "jwt.token.value",
      realtimeE2EEKey(config.e2eeSecret, SESSION, 7),
      config.apiSecret,
      config.roomSalt,
      config.e2eeSecret,
      realtimeRoomName(config.roomSalt, SESSION, 7),
      CLIENT,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("encerrar pela Elyra varre ate a geracao atual", async () => {
    vi.mocked(repository.readSessionMediaGeneration).mockResolvedValue(6);
    const provider = fakeProvider();
    await closeSessionMediaAfterAction(client, SESSION, { config, provider });
    const swept = vi.mocked(provider.closeRooms).mock.calls[0]![0];
    expect(swept).toContain(realtimeRoomName(config.roomSalt, SESSION, 6));
    expect(swept).toContain(realtimeRoomName(config.roomSalt, SESSION, 5));
  });

  it("evento do cliente: so o vocabulario fechado", async () => {
    await recordSessionMediaEventFor(client, SESSION, { event: "joined" });
    expect(repository.recordSessionMediaEvent).toHaveBeenCalledWith(client, SESSION, "REALTIME_JOINED");
    await expect(recordSessionMediaEventFor(client, SESSION, { event: "terminated" })).rejects.toThrow();
  });
});
