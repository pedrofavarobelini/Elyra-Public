import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { OUTBOX_DOMAIN, OUTBOX_KIND, OUTBOX_STATUS, type OutboxOperation } from "@/lib/offline/contracts";
import {
  OfflineQuotaError,
  OfflineStorageUnavailableError,
  createMemoryStore,
  type OfflineStore,
} from "@/lib/offline/db";
import {
  OfflineWriteUnavailableError,
  OnlineWriteError,
  WRITE_STATUS,
  createOfflineGateway,
} from "@/lib/offline/gateway";
import { applyOperations, type PersonalSlices } from "@/lib/offline/local-apply";
import type { SendResult } from "@/lib/offline/sync-engine";

const USER = "user-a";
const ENTRY = "22222222-2222-4222-8222-222222222222";

const offlineSender = vi.fn(async (): Promise<SendResult> => ({ status: null, body: null }));

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { configurable: true, get: () => value });
}

const journalSpec = (content: string, baseFingerprint: string | null) => ({
  domain: OUTBOX_DOMAIN.JOURNAL,
  kind: OUTBOX_KIND.UPDATE,
  entityId: ENTRY,
  coalesce: true,
  request: {
    path: "/api/journal/entries",
    method: "POST" as const,
    body: { id: ENTRY, title: "Dia", content, status: "draft", tagIds: [], baseFingerprint },
  },
});

beforeEach(() => {
  setOnline(true);
  offlineSender.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe("coalescencia so junta a mesma operacao (OFF-2)", () => {
  const GOAL = "44444444-4444-4444-8444-444444444444";
  it("meta criada offline e pausada offline: a criacao nao some; edicoes seguidas juntam", async () => {
    setOnline(false);
    vi.stubGlobal("fetch", vi.fn());
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });
    await gateway.write({ domain: OUTBOX_DOMAIN.GOAL, kind: OUTBOX_KIND.CREATE, entityId: GOAL, request: { path: "/api/goals", method: "POST", body: { id: GOAL, title: "Ler" } } });
    await gateway.write({ domain: OUTBOX_DOMAIN.GOAL, kind: OUTBOX_KIND.UPDATE, entityId: GOAL, coalesce: true, request: { path: "/api/goals", method: "PATCH", body: { id: GOAL, status: "paused", baseFingerprint: "b0" } } });
    await gateway.write({ domain: OUTBOX_DOMAIN.GOAL, kind: OUTBOX_KIND.UPDATE, entityId: GOAL, coalesce: true, request: { path: "/api/goals", method: "PUT", body: { id: GOAL, title: "Ler 10 páginas", target: 1, unit: null, baseFingerprint: "b1" } } });
    await gateway.write({ domain: OUTBOX_DOMAIN.GOAL, kind: OUTBOX_KIND.UPDATE, entityId: GOAL, coalesce: true, request: { path: "/api/goals", method: "PUT", body: { id: GOAL, title: "Ler 20 páginas", target: 1, unit: null, baseFingerprint: "b2" } } });
    const ops = await store.listOutbox(USER);
    expect(ops.map((op) => op.request.method)).toEqual(["POST", "PATCH", "PUT"]);
    // A edicao seguinte juntou na anterior e manteve a base da PRIMEIRA edicao.
    expect(ops[2]!.request.body).toMatchObject({ title: "Ler 20 páginas", baseFingerprint: "b1" });
  });
});

describe("gateway de escrita", () => {
  it("sem rede enfileira, nao chama fetch e devolve QUEUED", async () => {
    setOnline(false);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });

    const result = await gateway.write(journalSpec("sem rede", null));

    expect(result.status).toBe(WRITE_STATUS.QUEUED);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await store.listOutbox(USER)).toHaveLength(1);
  });

  it("online sem fila escreve direto; erro do servidor aparece como antes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "Anotação inválida." }), { status: 400 })),
    );
    const gateway = createOfflineGateway({ userId: USER, store: createMemoryStore(), mode: "online" });
    await expect(gateway.write(journalSpec("x", null))).rejects.toBeInstanceOf(OnlineWriteError);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ data: { id: ENTRY } }), { status: 201 })),
    );
    await expect(gateway.write(journalSpec("x", null))).resolves.toMatchObject({ status: WRITE_STATUS.SYNCED });
  });

  it("fetch que falha (resposta perdida) vira fila em vez de erro", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });
    const result = await gateway.write(journalSpec("rede caiu no meio", null));
    expect(result.status).toBe(WRITE_STATUS.QUEUED);
    expect(await store.listOutbox(USER)).toHaveLength(1);
  });

  it("modo shell sempre enfileira; autosave coalesce mantendo a base da primeira edicao", async () => {
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "shell", send: offlineSender });
    setOnline(false);
    await gateway.write(journalSpec("primeira", "a".repeat(64)));
    await gateway.write(journalSpec("segunda", "b".repeat(64)));
    await gateway.write(journalSpec("terceira", "c".repeat(64)));

    const ops = await store.listOutbox(USER);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.request.body).toMatchObject({ content: "terceira", baseFingerprint: "a".repeat(64) });
  });

  it("com fila pendente, escrita nova tambem entra na fila (ordem preservada)", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });
    setOnline(false);
    await gateway.write({ ...journalSpec("offline", null), coalesce: false });
    setOnline(true);
    await gateway.write({
      domain: OUTBOX_DOMAIN.GOAL_PROGRESS,
      kind: OUTBOX_KIND.CREATE,
      entityId: "p1",
      request: { path: "/api/goals/progress", method: "POST", body: { id: "p1" } },
      queuedBody: { day: "2026-09-17" },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    const ops = await store.listOutbox(USER);
    expect(ops.map((op) => op.entityId)).toEqual([ENTRY, "p1"]);
    expect(ops[1]!.request.body).toMatchObject({ day: "2026-09-17" });
  });

  it("offline confirmado pelo monitor enfileira sem tentar a rede", async () => {
    setOnline(true);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const store = createMemoryStore();
    const gateway = createOfflineGateway({
      userId: USER,
      store,
      mode: "online",
      send: offlineSender,
      isOffline: () => true,
    });

    const result = await gateway.write(journalSpec("queda confirmada", null));

    expect(result.status).toBe(WRITE_STATUS.QUEUED);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await store.listOutbox(USER)).toHaveLength(1);
  });

  it("falha de rede avisa o monitor (evidencia para confirmar a queda)", async () => {
    setOnline(true);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const onNetworkFailure = vi.fn();
    const gateway = createOfflineGateway({
      userId: USER,
      store: createMemoryStore(),
      mode: "online",
      send: offlineSender,
      onNetworkFailure,
    });

    await gateway.write(journalSpec("rede caiu", null));

    expect(onNetworkFailure).toHaveBeenCalled();
  });

  it("cota excedida nao finge que salvou", async () => {
    setOnline(false);
    const memory = createMemoryStore();
    const store: OfflineStore = {
      ...memory,
      putOperation: async () => {
        throw new OfflineQuotaError();
      },
    };
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });
    await expect(gateway.write(journalSpec("grande", null))).rejects.toBeInstanceOf(OfflineWriteUnavailableError);
    expect(await memory.listOutbox(USER)).toHaveLength(0);
  });

  it("IndexedDB indisponivel (modo privado, bloqueio) nao finge que salvou e avisa o estado", async () => {
    setOnline(false);
    const memory = createMemoryStore();
    const store: OfflineStore = {
      ...memory,
      putOperation: async () => {
        throw new OfflineStorageUnavailableError();
      },
    };
    const gateway = createOfflineGateway({ userId: USER, store, mode: "online", send: offlineSender });
    const failure = await gateway.write(journalSpec("sem banco local", null)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(OfflineWriteUnavailableError);
    expect((failure as OfflineWriteUnavailableError).reason).toBe("storage");
    expect(gateway.getState().storageAvailable).toBe(false);
  });

  it("conflito do diario: manter as duas cria copia nova e aceita a versao do servidor", async () => {
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "shell", send: offlineSender });
    const reconciled: unknown[] = [];
    gateway.setReconciler((_op, body) => reconciled.push(body));
    setOnline(false);
    await gateway.write(journalSpec("minha versao", "a".repeat(64)));
    const [op] = await store.listOutbox(USER);
    await store.putOperation({
      ...op!,
      status: OUTBOX_STATUS.CONFLICT,
      conflictCurrent: { id: ENTRY, title: "Dia", content: "versao de outro aparelho", status: "saved", tagIds: [] },
    });

    await gateway.keepBoth(op!.id);

    const ops = await store.listOutbox(USER);
    expect(ops).toHaveLength(1);
    expect(ops[0]!.entityId).not.toBe(ENTRY);
    expect(ops[0]!.request.body).toMatchObject({
      content: "minha versao",
      title: "Dia (cópia deste aparelho)",
      baseFingerprint: null,
    });
    expect(reconciled).toEqual([{ data: expect.objectContaining({ content: "versao de outro aparelho" }) }]);
  });

  it("logout durante um envio em curso nao deixa a operacao voltar", async () => {
    setOnline(true);
    const store = createMemoryStore();
    let release: () => void = () => undefined;
    const slowSender = vi.fn(
      () => new Promise<SendResult>((resolve) => {
        release = () => resolve({ status: null, body: null });
      }),
    );
    const gateway = createOfflineGateway({ userId: USER, store, mode: "shell", send: slowSender });
    await gateway.write(journalSpec("pendente", null));
    await vi.waitFor(() => expect(slowSender).toHaveBeenCalled());
    const clearing = gateway.clearLocal();
    release();
    await clearing;
    expect(await store.listOutbox(USER)).toEqual([]);
  });

  it("logout apaga fila, snapshot e aparelho so desta pessoa", async () => {
    const store = createMemoryStore();
    const gateway = createOfflineGateway({ userId: USER, store, mode: "shell", send: offlineSender });
    setOnline(false);
    await gateway.markVerified({ displayName: "A", initials: "A" });
    await gateway.saveSnapshot({ checkins: [] });
    await gateway.write(journalSpec("x", null));
    await store.putOperation({ ...(await store.listOutbox(USER))[0]!, id: "outra", userId: "user-b" });

    await gateway.clearLocal();

    expect(await store.listOutbox(USER)).toEqual([]);
    expect(await store.getSnapshot(USER)).toBeNull();
    expect(await store.getDevice()).toBeNull();
    expect(await store.listOutbox("user-b")).toHaveLength(1);
  });

  it("snapshot que termina depois do logout nao reaparece no aparelho", async () => {
    const base = createMemoryStore();
    let releasePut: () => Promise<void> = async () => undefined;
    let resolveDeleted: () => void = () => undefined;
    const deleted = new Promise<void>((resolve) => {
      resolveDeleted = resolve;
    });
    const store: OfflineStore = {
      ...base,
      putSnapshot: (snapshot) =>
        new Promise<void>((resolve) => {
          releasePut = async () => {
            await base.putSnapshot(snapshot);
            resolve();
          };
        }),
      async deleteSnapshot(userId) {
        await base.deleteSnapshot(userId);
        resolveDeleted();
      },
    };
    const gateway = createOfflineGateway({
      userId: USER,
      store,
      mode: "shell",
      send: offlineSender,
    });

    const saving = gateway.saveSnapshot({ checkins: [] });
    const clearing = gateway.clearLocal();
    await deleted;
    await releasePut();
    await Promise.all([saving, clearing]);

    expect(await store.getSnapshot(USER)).toBeNull();
  });
});

describe("estado exibido = base + fila", () => {
  const empty: PersonalSlices = { checkins: [], sleep: [], journal: [], goals: [], goalProgress: [], cycleRecords: [] };
  const op = (patch: Partial<OutboxOperation>): OutboxOperation => ({
    id: crypto.randomUUID(),
    userId: USER,
    domain: OUTBOX_DOMAIN.GOAL_PROGRESS,
    kind: OUTBOX_KIND.CREATE,
    entityId: "p1",
    dependsOn: null,
    request: { path: "/api/goals/progress", method: "POST", body: { id: "p1", goalId: "g1", amount: 1, day: "2026-09-17" } },
    sequence: 1,
    createdAt: "2026-09-17T10:00:00.000Z",
    attempts: 0,
    serverAttempts: 0,
    nextAttemptAt: "2026-09-17T10:00:00.000Z",
    status: OUTBOX_STATUS.PENDING,
    lastError: null,
    conflictCurrent: null,
    ...patch,
  });

  it("aplicar duas vezes ou sobre base ja confirmada nao duplica", () => {
    const pending = [op({})];
    const once = applyOperations(empty, pending);
    const twice = applyOperations(once, pending);
    expect(once.goalProgress).toHaveLength(1);
    expect(twice.goalProgress).toEqual(once.goalProgress);
  });

  it("exclusao pendente nao ressuscita quando chega base nova do servidor", () => {
    const serverBase: PersonalSlices = {
      ...empty,
      journal: [
        {
          id: ENTRY, title: "Dia", content: "x", status: "saved", tagIds: [],
          createdAt: "2026-09-16T10:00:00Z", updatedAt: "2026-09-16T10:00:00Z", trashedAt: null,
        },
      ],
    };
    const purge = op({
      domain: OUTBOX_DOMAIN.JOURNAL,
      kind: OUTBOX_KIND.DELETE,
      entityId: ENTRY,
      request: { path: "/api/journal/entries", method: "DELETE", body: { id: ENTRY } },
    });
    expect(applyOperations(serverBase, [purge]).journal).toEqual([]);
  });

  it("registro de ciclo offline fica observado e sem estimativa", () => {
    const record = op({
      domain: OUTBOX_DOMAIN.CYCLE_RECORD,
      kind: OUTBOX_KIND.CREATE,
      entityId: "cycle:2026-09-17",
      request: {
        path: "/api/cycle/records",
        method: "POST",
        body: { date: "2026-09-17", flow: "light", note: null, symptoms: [], baseFingerprint: null },
      },
    });
    const result = applyOperations(empty, [record, record]);
    expect(result.cycleRecords).toEqual([
      { id: "local-cycle-2026-09-17", date: "2026-09-17", flow: "light", note: null, symptoms: [] },
    ]);
  });
});
