import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AdminClient } from "@/lib/supabase/admin";
import { EmailTransportError, type EmailMessage, type EmailTransport } from "@/server/email/transport";
import { EMAIL_FORBIDDEN_TERMS } from "@/server/email/templates";
import {
  dentroDaJanela,
  dispatchConfig,
  dispatchNotificationEmails,
} from "@/server/jobs/notification-email-dispatcher";

const ENV = { ELYRA_PUBLIC_APP_URL: "http://localhost:3000" };
// 14h em Sao Paulo: dentro da janela padrao 8-21.
const MEIO_DIA = new Date("2026-09-25T17:00:00Z");
const MADRUGADA = new Date("2026-09-25T06:00:00Z"); // 3h em Sao Paulo

type Due = { user_id: string; kind: string; event_key: string };

/**
 * Admin falso: o banco e simulado so no que o dispatcher conversa com ele.
 * `enqueue` segue a regra real da RPC — uma janela por (user_id, event_key).
 */
function fakeAdmin(options: {
  due?: Due[];
  used?: number;
  users?: Record<string, { email: string | null; confirmed: boolean }>;
  enqueueError?: boolean;
  optedOut?: Set<string>;
}) {
  const janelas = new Set<string>();
  const settled: Array<{ id: string; status: string; code?: string }> = [];
  const runs: Array<Record<string, unknown>> = [];
  let seq = 0;
  const rpc = vi.fn(async (name: string, args: Record<string, unknown> = {}) => {
    switch (name) {
      case "email_deliveries_used_since":
        return { data: options.used ?? 0, error: null };
      case "due_notification_emails":
        return { data: (options.due ?? []).slice(0, args.p_limit as number), error: null };
      case "enqueue_notification_email_for": {
        if (options.enqueueError) return { data: null, error: { message: "x" } };
        const key = `${args.p_user_id}|${args.p_event_key}`;
        if (options.optedOut?.has(args.p_user_id as string) || janelas.has(key)) return { data: null, error: null };
        janelas.add(key);
        seq += 1;
        return { data: `delivery-${seq}`, error: null };
      }
      case "settle_notification_email_for":
        settled.push({ id: args.p_delivery_id as string, status: args.p_status as string, code: args.p_failure_code as string | undefined });
        return { data: true, error: null };
      case "purge_email_delivery_history":
        return { data: 0, error: null };
      default:
        throw new Error(`rpc inesperada ${name}`);
    }
  });
  const from = vi.fn(() => ({
    insert: (row: Record<string, unknown>) => ({
      select: () => ({
        single: async () => {
          runs.push({ ...row, outcome: "running" });
          return { data: { id: "run-1" }, error: null };
        },
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async () => {
        Object.assign(runs[0]!, patch);
        return { error: null };
      },
    }),
  }));
  const getUserById = vi.fn(async (id: string) => {
    const u = options.users?.[id];
    if (!u) return { data: { user: null }, error: { status: 404 } };
    return { data: { user: { id, email: u.email, email_confirmed_at: u.confirmed ? "2026-01-01" : null } }, error: null };
  });
  const admin = { rpc, from, auth: { admin: { getUserById } } } as unknown as AdminClient;
  return { admin, rpc, settled, runs, getUserById };
}

function fakeTransport(kind: EmailTransport["kind"], send?: (m: EmailMessage) => Promise<void>) {
  const sent: EmailMessage[] = [];
  const transport: EmailTransport = {
    kind,
    send: async (m) => {
      sent.push(m);
      if (send) await send(m);
    },
  };
  return { transport, sent };
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const users = {
  [A]: { email: "a@example.invalid", confirmed: true },
  [B]: { email: "b@example.invalid", confirmed: false },
};

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => logs.push(args.map(String).join(" ")));
  }
});
afterEach(() => vi.restoreAllMocks());

const run = (admin: AdminClient, transport: EmailTransport, extra: Partial<Parameters<typeof dispatchNotificationEmails>[0]> = {}) =>
  dispatchNotificationEmails({ env: ENV, admin, transport, now: MEIO_DIA, sleep: async () => {}, ...extra });

describe("configuracao", () => {
  it("padroes: Sao Paulo, 8-21 h, 100/dia, lote 50", () => {
    expect(dispatchConfig({})).toEqual({
      timezone: "America/Sao_Paulo",
      sendHours: { start: 8, end: 21 },
      dailyLimit: 100,
      batchSize: 50,
    });
  });
  it("valor absurdo volta ao padrao em vez de abrir a cota", () => {
    const c = dispatchConfig({
      ELYRA_EMAIL_DAILY_LIMIT: "100000",
      ELYRA_NOTIFICATION_DISPATCH_BATCH: "-1",
      ELYRA_NOTIFICATION_TIMEZONE: "Marte/Base",
      ELYRA_NOTIFICATION_SEND_HOURS: "22-3",
    });
    expect(c).toEqual(dispatchConfig({}));
  });
  it("janela de horario no fuso da instalacao", () => {
    expect(dentroDaJanela(MEIO_DIA, dispatchConfig({}))).toBe(true);
    expect(dentroDaJanela(MADRUGADA, dispatchConfig({}))).toBe(false);
  });
});

describe("disponibilidade", () => {
  it("sem transporte, URL ou cliente de sistema: nem registra execucao", async () => {
    const { admin, runs } = fakeAdmin({});
    await expect(dispatchNotificationEmails({ env: ENV, admin, transport: null })).resolves.toEqual({
      status: "unavailable",
      reason: "transport_missing",
    });
    await expect(
      dispatchNotificationEmails({ env: {}, admin, transport: fakeTransport("brevo").transport }),
    ).resolves.toEqual({ status: "unavailable", reason: "app_url_missing" });
    await expect(
      dispatchNotificationEmails({ env: ENV, admin: null, transport: fakeTransport("brevo").transport }),
    ).resolves.toEqual({ status: "unavailable", reason: "admin_missing" });
    expect(runs).toHaveLength(0);
  });
});

describe("envio", () => {
  it("lote vazio conclui e registra batimento", async () => {
    const { admin, runs } = fakeAdmin({ due: [] });
    const r = await run(admin, fakeTransport("brevo").transport);
    expect(r).toMatchObject({ status: "completed", selected: 0, delivered: 0 });
    expect(runs[0]).toMatchObject({ outcome: "completed", selected: 0 });
  });

  it("elegivel com endereco confirmado: envia e liquida como sent (Brevo)", async () => {
    const { admin, settled } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
    const { transport, sent } = fakeTransport("brevo");
    const r = await run(admin, transport);
    expect(r).toMatchObject({ status: "completed", selected: 1, delivered: 1, failed: 0 });
    expect(sent[0]!.to).toBe("a@example.invalid");
    expect(settled).toEqual([{ id: "delivery-1", status: "sent", code: undefined }]);
  });

  it("captura (mailpit/local_capture) liquida como captured, nunca sent", async () => {
    for (const kind of ["mailpit", "local_capture"] as const) {
      const { admin, settled } = fakeAdmin({ due: [{ user_id: A, kind: "goal_reminder", event_key: "goal_reminder:2026-09-25" }], users });
      await run(admin, fakeTransport(kind).transport);
      expect(settled[0]!.status).toBe("captured");
    }
  });

  it("endereco nao confirmado ou ausente: suprimido, nada enviado", async () => {
    const { admin, rpc } = fakeAdmin({
      due: [
        { user_id: B, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" },
        { user_id: "33333333-3333-4333-8333-333333333333", kind: "weekly_digest", event_key: "weekly_digest:2026-W39" },
      ],
      users,
    });
    const { transport, sent } = fakeTransport("brevo");
    const r = await run(admin, transport);
    expect(r).toMatchObject({ selected: 2, suppressed: 2, delivered: 0 });
    expect(sent).toHaveLength(0);
    expect(rpc.mock.calls.some(([n]) => n === "enqueue_notification_email_for")).toBe(false);
  });

  it("preferencia desligada entre a selecao e o envio: o banco recusa e nada sai", async () => {
    const { admin } = fakeAdmin({
      due: [{ user_id: A, kind: "checkin_reminder", event_key: "checkin_reminder:2026-09-25" }],
      users,
      optedOut: new Set([A]),
    });
    const { transport, sent } = fakeTransport("brevo");
    expect(await run(admin, transport)).toMatchObject({ suppressed: 1, delivered: 0 });
    expect(sent).toHaveLength(0);
  });

  it("mesma janela duas vezes no lote (ou em duas execucoes): uma entrega", async () => {
    const item = { user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" };
    const { admin } = fakeAdmin({ due: [item, item], users });
    const { transport, sent } = fakeTransport("brevo");
    expect(await run(admin, transport)).toMatchObject({ delivered: 1, suppressed: 1 });
    expect(sent).toHaveLength(1);
  });

  it("falha transitoria: retry finito dentro da execucao, depois liquida failed", async () => {
    const { admin, settled } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
    const { transport, sent } = fakeTransport("brevo", async () => {
      throw new EmailTransportError("http_503");
    });
    const r = await run(admin, transport);
    expect(sent).toHaveLength(3);
    expect(r).toMatchObject({ delivered: 0, failed: 1 });
    expect(settled).toEqual([{ id: "delivery-1", status: "failed", code: "http_503" }]);
  });

  it("transitoria que se resolve: entrega na tentativa seguinte", async () => {
    let n = 0;
    const { admin } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
    const { transport, sent } = fakeTransport("brevo", async () => {
      n += 1;
      if (n === 1) throw new EmailTransportError("http_429");
    });
    expect(await run(admin, transport)).toMatchObject({ delivered: 1 });
    expect(sent).toHaveLength(2);
  });

  it("timeout nao repete (a mensagem pode ter saido) e permanente nao repete", async () => {
    for (const code of ["timeout", "http_422"]) {
      const { admin, settled } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
      const { transport, sent } = fakeTransport("brevo", async () => {
        throw new EmailTransportError(code);
      });
      await run(admin, transport);
      expect(sent, code).toHaveLength(1);
      expect(settled[0]).toMatchObject({ status: "failed", code });
    }
  });

  it("erro de um item nao derruba o lote", async () => {
    const { admin } = fakeAdmin({
      due: [
        { user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" },
        { user_id: A, kind: "goal_reminder", event_key: "goal_reminder:2026-09-25" },
      ],
      users,
    });
    let n = 0;
    const { transport } = fakeTransport("brevo", async () => {
      n += 1;
      if (n === 1) throw new Error("bug inesperado");
    });
    const r = await run(admin, transport);
    expect(r.status).toBe("completed");
    expect(r).toMatchObject({ failed: 1, delivered: 1 });
  });

  it("falha ao enfileirar conta como falha, sem enviar", async () => {
    const { admin } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users, enqueueError: true });
    const { transport, sent } = fakeTransport("brevo");
    expect(await run(admin, transport)).toMatchObject({ failed: 1 });
    expect(sent).toHaveLength(0);
  });

  it("tipo fora do contrato vindo do banco e suprimido", async () => {
    const { admin } = fakeAdmin({ due: [{ user_id: A, kind: "marketing", event_key: "marketing:2026-09-25" }], users });
    const { transport, sent } = fakeTransport("brevo");
    expect(await run(admin, transport)).toMatchObject({ suppressed: 1 });
    expect(sent).toHaveLength(0);
  });
});

describe("tetos", () => {
  it("fora da janela de horario: nada selecionado, batimento registrado", async () => {
    const { admin, rpc, runs } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
    const r = await run(admin, fakeTransport("brevo").transport, { now: MADRUGADA });
    expect(r.status).toBe("outside_window");
    expect(rpc.mock.calls.some(([n]) => n === "due_notification_emails")).toBe(false);
    expect(runs[0]!.outcome).toBe("outside_window");
  });

  it("cota diaria atingida: nao pede lote", async () => {
    const { admin, rpc } = fakeAdmin({ used: 100, users });
    expect((await run(admin, fakeTransport("brevo").transport)).status).toBe("quota_reached");
    expect(rpc.mock.calls.some(([n]) => n === "due_notification_emails")).toBe(false);
  });

  it("lote nunca passa do que resta da cota", async () => {
    const { admin, rpc } = fakeAdmin({ used: 97, due: [], users });
    await run(admin, fakeTransport("brevo").transport);
    const call = rpc.mock.calls.find(([n]) => n === "due_notification_emails");
    expect(call?.[1]).toEqual({ p_timezone: "America/Sao_Paulo", p_limit: 3 });
  });
});

describe("privacidade", () => {
  it("o e-mail enviado e o convite estatico: sem termo proibido, sem dado da conta", async () => {
    const { admin } = fakeAdmin({
      due: ["checkin_reminder", "goal_reminder", "weekly_digest"].map((kind) => ({
        user_id: A,
        kind,
        event_key: kind === "weekly_digest" ? "weekly_digest:2026-W39" : `${kind}:2026-09-25`,
      })),
      users,
    });
    const { transport, sent } = fakeTransport("brevo");
    await run(admin, transport);
    expect(sent).toHaveLength(3);
    for (const m of sent) {
      const texto = `${m.subject} ${m.body} ${m.html}`.toLowerCase();
      for (const termo of EMAIL_FORBIDDEN_TERMS) expect(texto, termo).not.toContain(termo.toLowerCase());
      expect(texto).not.toContain("a@example.invalid");
    }
  });

  it("log sem endereco, assunto ou corpo", async () => {
    const { admin } = fakeAdmin({ due: [{ user_id: A, kind: "weekly_digest", event_key: "weekly_digest:2026-W39" }], users });
    const { transport, sent } = fakeTransport("brevo");
    await run(admin, transport);
    const tudo = logs.join("\n");
    expect(tudo).toContain("elyra.notification_dispatch run=run-1 outcome=completed");
    expect(tudo).not.toContain("a@example.invalid");
    expect(tudo).not.toContain(sent[0]!.subject);
  });
});
