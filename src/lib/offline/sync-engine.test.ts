import { describe, expect, it, vi } from "vitest";

import {
  BACKOFF_MAX_MS,
  MAX_SERVER_ATTEMPTS,
  OUTBOX_DOMAIN,
  OUTBOX_KIND,
  OUTBOX_STATUS,
  backoffDelay,
  canOpenOffline,
  classifySend,
  fingerprint,
  journalContent,
  type DeviceRecord,
  type OutboxRequest,
} from "@/lib/offline/contracts";
import { createMemoryStore, recoverInterrupted } from "@/lib/offline/db";
import {
  DRAIN_RESULT,
  createSyncEngine,
  enqueue,
  type SendResult,
} from "@/lib/offline/sync-engine";

const USER = "user-a";
const T0 = new Date("2026-09-17T12:00:00.000Z");

/** Servidor falso com estado: prova idempotencia e ordem, nao so chamadas. */
function fakeServer() {
  const goals = new Map<string, { id: string; status: string }>();
  const progress = new Map<string, { id: string; goalId: string; amount: number }>();
  const calls: OutboxRequest[] = [];
  let loseNextAck = false;

  async function handle(request: OutboxRequest): Promise<SendResult> {
    calls.push(request);
    const body = request.body as Record<string, unknown>;
    let result: SendResult;
    if (request.path === "/api/goals" && request.method === "POST") {
      const id = String(body.id);
      if (!goals.has(id)) goals.set(id, { id, status: "active" });
      result = { status: 201, body: { data: { ...goals.get(id)! } } };
    } else if (request.path === "/api/goals" && request.method === "PATCH") {
      const goal = goals.get(String(body.id));
      if (!goal) return { status: 404, body: { error: "not found" } };
      goal.status = String(body.status);
      result = { status: 200, body: { data: { ...goal } } };
    } else if (request.path === "/api/goals/progress") {
      const id = String(body.id);
      if (!progress.has(id)) {
        progress.set(id, { id, goalId: String(body.goalId), amount: Number(body.amount) });
      }
      result = { status: 201, body: { data: { ...progress.get(id)! } } };
    } else {
      result = { status: 500, body: null };
    }
    if (loseNextAck) {
      // Escrita aplicada no servidor, resposta perdida no caminho.
      loseNextAck = false;
      return { status: null, body: null };
    }
    return result;
  }

  return {
    goals,
    progress,
    calls,
    loseAck: () => {
      loseNextAck = true;
    },
    send: vi.fn((request: OutboxRequest) => handle(request)),
  };
}

function engineFor(store = createMemoryStore(), send = fakeServer().send, now = () => T0) {
  return createSyncEngine({ store, userId: USER, send, now, random: () => 0.5 });
}

async function queueGoalFlow(store: ReturnType<typeof createMemoryStore>) {
  const goalId = "11111111-1111-4111-8111-111111111111";
  await enqueue(store, {
    userId: USER,
    domain: OUTBOX_DOMAIN.GOAL,
    kind: OUTBOX_KIND.CREATE,
    entityId: goalId,
    request: { path: "/api/goals", method: "POST", body: { id: goalId, title: "Caminhar" } },
    now: T0,
  });
  for (const id of ["p1", "p2"]) {
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.GOAL_PROGRESS,
      kind: OUTBOX_KIND.CREATE,
      entityId: id,
      dependsOn: goalId,
      request: { path: "/api/goals/progress", method: "POST", body: { id, goalId, amount: 1 } },
      now: T0,
    });
  }
  await enqueue(store, {
    userId: USER,
    domain: OUTBOX_DOMAIN.GOAL,
    kind: OUTBOX_KIND.UPDATE,
    entityId: goalId,
    request: { path: "/api/goals", method: "PATCH", body: { id: goalId, status: "paused" } },
    now: T0,
  });
  return goalId;
}

describe("contratos puros", () => {
  it("backoff cresce exponencialmente com teto e jitter limitado", () => {
    expect(backoffDelay(1, () => 0.5)).toBe(1_000);
    expect(backoffDelay(2, () => 0.5)).toBe(2_000);
    expect(backoffDelay(4, () => 0.5)).toBe(8_000);
    expect(backoffDelay(30, () => 0.5)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(3, () => 0)).toBe(3_200);
    expect(backoffDelay(3, () => 1)).toBe(4_800);
  });

  it("classifica respostas sem tratar 404 de edicao como sucesso", () => {
    expect(classifySend(null, OUTBOX_KIND.CREATE)).toBe("NETWORK");
    expect(classifySend(201, OUTBOX_KIND.CREATE)).toBe("ACK");
    expect(classifySend(401, OUTBOX_KIND.UPDATE)).toBe("AUTH");
    expect(classifySend(409, OUTBOX_KIND.UPDATE)).toBe("CONFLICT");
    expect(classifySend(404, OUTBOX_KIND.DELETE)).toBe("ACK");
    expect(classifySend(404, OUTBOX_KIND.UPDATE)).toBe("CONFLICT");
    expect(classifySend(422, OUTBOX_KIND.CREATE)).toBe("PERMANENT");
    expect(classifySend(503, OUTBOX_KIND.CREATE)).toBe("TRANSIENT");
    expect(classifySend(429, OUTBOX_KIND.CREATE)).toBe("TRANSIENT");
  });

  it("sessao offline so abre com verificacao online de ate 14 dias", () => {
    const device: DeviceRecord = {
      key: "current",
      userId: USER,
      displayName: "A",
      initials: "A",
      verifiedAt: T0.toISOString(),
      schemaVersion: 1,
    };
    expect(canOpenOffline(null, T0)).toBe(false);
    expect(canOpenOffline(device, new Date(T0.getTime() + 13 * 86_400_000))).toBe(true);
    expect(canOpenOffline(device, new Date(T0.getTime() + 15 * 86_400_000))).toBe(false);
    expect(canOpenOffline({ ...device, verifiedAt: "lixo" }, T0)).toBe(false);
  });

  it("impressao digital ignora ordem de chaves e de tags", async () => {
    const a = await fingerprint(journalContent({ title: "t", content: "c", status: "saved", tagIds: ["b", "a"] }));
    const b = await fingerprint({ tagIds: ["a", "b"], status: "saved", content: "c", title: "t" });
    const c = await fingerprint(journalContent({ title: "t", content: "outro", status: "saved", tagIds: ["a", "b"] }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("motor de sync", () => {
  it("fila sobrevive e drena em ordem: +1, +1, pausar da estado final deterministico", async () => {
    const store = createMemoryStore();
    const server = fakeServer();
    const goalId = await queueGoalFlow(store);

    const result = await engineFor(store, server.send).drain();

    expect(result.outcome).toBe(DRAIN_RESULT.IDLE);
    expect(result.acknowledged).toBe(4);
    expect(await store.listOutbox(USER)).toEqual([]);
    expect(server.calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "POST /api/goals",
      "POST /api/goals/progress",
      "POST /api/goals/progress",
      "PATCH /api/goals",
    ]);
    expect(server.progress.size).toBe(2);
    expect(server.goals.get(goalId)?.status).toBe("paused");
  });

  it("ACK perdido: o reenvio nao duplica o registro", async () => {
    const store = createMemoryStore();
    const server = fakeServer();
    await queueGoalFlow(store);

    server.loseAck(); // a criacao da meta chega, a resposta nao
    const first = await engineFor(store, server.send).drain();
    expect(first.outcome).toBe(DRAIN_RESULT.OFFLINE);
    expect(server.goals.size).toBe(1);
    const pending = await store.listOutbox(USER);
    expect(pending).toHaveLength(4);
    expect(pending[0]!.attempts).toBe(1);
    expect(pending[0]!.serverAttempts).toBe(0); // rede nao consome o limite

    // Depois do backoff, a fila inteira drena sem criar segunda meta.
    const later = () => new Date(T0.getTime() + 60_000);
    const second = await engineFor(store, server.send, later).drain();
    expect(second.outcome).toBe(DRAIN_RESULT.IDLE);
    expect(server.goals.size).toBe(1);
    expect(server.progress.size).toBe(2);
  });

  it("respeita o prazo de retry e nao reenvia antes dele", async () => {
    const store = createMemoryStore();
    const send = vi.fn(async (): Promise<SendResult> => ({ status: null, body: null }));
    await queueGoalFlow(store);

    await engineFor(store, send).drain();
    expect(send).toHaveBeenCalledTimes(1);

    const early = await engineFor(store, send, () => new Date(T0.getTime() + 500)).drain();
    expect(send).toHaveBeenCalledTimes(1);
    expect(early.nextAttemptAt).toBe(new Date(T0.getTime() + 1_000).toISOString());
  });

  it("timeout conta como rede e nao bloqueia para sempre", async () => {
    const store = createMemoryStore();
    await queueGoalFlow(store);
    const hanging = vi.fn(
      (_request: OutboxRequest, signal: AbortSignal) =>
        new Promise<SendResult>((resolve) => {
          signal.addEventListener("abort", () => resolve({ status: null, body: null }));
        }),
    );
    const engine = createSyncEngine({ store, userId: USER, send: hanging, now: () => T0, timeoutMs: 20 });
    const result = await engine.drain();
    expect(result.outcome).toBe(DRAIN_RESULT.OFFLINE);
    expect((await store.listOutbox(USER))[0]!.lastError?.code).toBe("network");
  });

  it("5xx faz backoff e vira FAILED apos o limite, sem apagar o dado", async () => {
    const store = createMemoryStore();
    const send = vi.fn(async (): Promise<SendResult> => ({ status: 503, body: null }));
    await queueGoalFlow(store);

    let clock = T0.getTime();
    for (let i = 0; i < MAX_SERVER_ATTEMPTS + 2; i++) {
      await engineFor(store, send, () => new Date(clock)).drain();
      clock += BACKOFF_MAX_MS * 2;
    }
    const [first, ...rest] = await store.listOutbox(USER);
    expect(first!.status).toBe(OUTBOX_STATUS.FAILED);
    expect(first!.serverAttempts).toBe(MAX_SERVER_ATTEMPTS);
    expect(first!.request.body).toMatchObject({ title: "Caminhar" });
    // Progresso e status dependem da meta: esperam, nao sao enviados.
    expect(rest.every((op) => op.status === OUTBOX_STATUS.PENDING)).toBe(true);
    expect(send).toHaveBeenCalledTimes(MAX_SERVER_ATTEMPTS);
  });

  it("401 pausa a drenagem e preserva a fila inteira", async () => {
    const store = createMemoryStore();
    const send = vi.fn(async (): Promise<SendResult> => ({ status: 401, body: null }));
    await queueGoalFlow(store);

    const result = await engineFor(store, send).drain();
    expect(result.outcome).toBe(DRAIN_RESULT.AUTH_REQUIRED);
    expect(send).toHaveBeenCalledTimes(1);
    const ops = await store.listOutbox(USER);
    expect(ops).toHaveLength(4);
    expect(ops[0]!.lastError?.code).toBe("auth_required");
  });

  it("409 guarda a versao do servidor e bloqueia so a cadeia da entidade", async () => {
    const store = createMemoryStore();
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.JOURNAL,
      kind: OUTBOX_KIND.UPDATE,
      entityId: "entry-1",
      request: { path: "/api/journal/entries", method: "POST", body: { id: "entry-1" } },
    });
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.JOURNAL,
      kind: OUTBOX_KIND.UPDATE,
      entityId: "entry-1",
      request: { path: "/api/journal/entries", method: "POST", body: { id: "entry-1", second: true } },
    });
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.JOURNAL,
      kind: OUTBOX_KIND.CREATE,
      entityId: "entry-2",
      request: { path: "/api/journal/entries", method: "POST", body: { id: "entry-2" } },
    });
    const send = vi.fn(async (request: OutboxRequest): Promise<SendResult> =>
      request.body.id === "entry-1"
        ? { status: 409, body: { error: "conflict", conflict: { title: "do servidor" } } }
        : { status: 201, body: { data: { id: request.body.id } } },
    );

    const result = await createSyncEngine({ store, userId: USER, send }).drain();

    expect(result.acknowledged).toBe(1);
    expect(send).toHaveBeenCalledTimes(2); // entry-1 (409) e entry-2; segunda edicao de entry-1 espera
    const ops = await store.listOutbox(USER);
    expect(ops).toHaveLength(2);
    expect(ops[0]!.status).toBe(OUTBOX_STATUS.CONFLICT);
    expect(ops[0]!.conflictCurrent).toEqual({ title: "do servidor" });
    expect(ops[1]!.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it("404 em DELETE e sucesso; 422 vira FAILED", async () => {
    const store = createMemoryStore();
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.JOURNAL,
      kind: OUTBOX_KIND.DELETE,
      entityId: "gone",
      request: { path: "/api/journal/entries", method: "DELETE", body: { id: "gone" } },
    });
    await enqueue(store, {
      userId: USER,
      domain: OUTBOX_DOMAIN.CHECKIN,
      kind: OUTBOX_KIND.CREATE,
      entityId: "bad",
      request: { path: "/api/emotional/checkins", method: "POST", body: { id: "bad" } },
    });
    const send = vi.fn(async (request: OutboxRequest): Promise<SendResult> =>
      request.method === "DELETE" ? { status: 404, body: null } : { status: 422, body: null },
    );
    await createSyncEngine({ store, userId: USER, send }).drain();
    const ops = await store.listOutbox(USER);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.entityId).toBe("bad");
    expect(ops[0]!.status).toBe(OUTBOX_STATUS.FAILED);
  });

  it("so envia operacoes do usuario do motor e reconcilia no ACK", async () => {
    const store = createMemoryStore();
    await queueGoalFlow(store);
    await enqueue(store, {
      userId: "user-b",
      domain: OUTBOX_DOMAIN.GOAL,
      kind: OUTBOX_KIND.CREATE,
      entityId: "b-goal",
      request: { path: "/api/goals", method: "POST", body: { id: "b-goal" } },
    });
    const server = fakeServer();
    const onAck = vi.fn();
    await createSyncEngine({ store, userId: USER, send: server.send, onAck }).drain();
    expect(server.calls.some((call) => call.body.id === "b-goal")).toBe(false);
    expect(await store.listOutbox("user-b")).toHaveLength(1);
    expect(onAck).toHaveBeenCalledTimes(4);
    expect(onAck.mock.calls[0]![1]).toMatchObject({ data: { status: "active" } });
  });

  it("drenagem concorrente nao envia em dobro", async () => {
    const store = createMemoryStore();
    const server = fakeServer();
    await queueGoalFlow(store);
    const engine = engineFor(store, server.send);
    const [a, b] = await Promise.all([engine.drain(), engine.drain()]);
    expect([a.outcome, b.outcome]).toContain(DRAIN_RESULT.BUSY);
    expect(server.calls).toHaveLength(4);
  });

  it("operacao apagada durante o envio (logout) nao volta para a fila", async () => {
    const store = createMemoryStore();
    await queueGoalFlow(store);
    const send = vi.fn(async (): Promise<SendResult> => {
      await store.deleteOutbox(USER); // logout no meio do envio
      return { status: null, body: null };
    });
    await createSyncEngine({ store, userId: USER, send, now: () => T0 }).drain();
    expect(await store.listOutbox(USER)).toEqual([]);
  });

  it("envio interrompido (SYNCING apos fechar o app) volta a pendente", async () => {
    const store = createMemoryStore();
    await queueGoalFlow(store);
    const [first] = await store.listOutbox(USER);
    await store.putOperation({ ...first!, status: OUTBOX_STATUS.SYNCING });
    await recoverInterrupted(store, USER);
    expect((await store.listOutbox(USER))[0]!.status).toBe(OUTBOX_STATUS.PENDING);
  });

  it("sequencia mantem a ordem mesmo no mesmo milissegundo", async () => {
    const store = createMemoryStore();
    for (const id of ["x", "y", "z"]) {
      await enqueue(store, {
        userId: USER,
        domain: OUTBOX_DOMAIN.GOAL_PROGRESS,
        kind: OUTBOX_KIND.CREATE,
        entityId: id,
        request: { path: "/api/goals/progress", method: "POST", body: { id } },
        now: T0,
      });
    }
    expect((await store.listOutbox(USER)).map((op) => op.entityId)).toEqual(["x", "y", "z"]);
  });
});
