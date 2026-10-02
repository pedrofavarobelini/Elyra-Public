import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { AdminClient } from "@/lib/supabase/admin";
import { EmailTransportError, type EmailMessage, type EmailTransport } from "@/server/email/transport";
import {
  RECOVERY_CONFIRM_PATH,
  deliverRecoveryEmail,
  recoveryDeliveryMode,
} from "@/server/services/recovery-delivery-service";

const TOKEN = "0123456789abcdef".repeat(3) + "01234567"; // 56 hex, como o GoTrue devolve
const ENV = {
  ELYRA_PUBLIC_APP_URL: "http://localhost:3000",
  ELYRA_EMAIL_TRANSPORT: "brevo",
  BREVO_API_KEY: "chave-fixture",
  ELYRA_EMAIL_SENDER_ADDRESS: "nao-responda@example.invalid",
};

function admin(result: { data?: unknown; error?: unknown } | Error): AdminClient {
  return {
    auth: {
      admin: {
        generateLink: vi.fn(async () => {
          if (result instanceof Error) throw result;
          return { data: result.data ?? null, error: result.error ?? null };
        }),
      },
    },
  } as unknown as AdminClient;
}

function transport(send: (m: EmailMessage) => Promise<void> = async () => {}) {
  const sent: EmailMessage[] = [];
  const t: EmailTransport = {
    kind: "brevo",
    send: async (m) => {
      sent.push(m);
      await send(m);
    },
  };
  return { t, sent };
}

let logs: string[];
beforeEach(() => {
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});
afterEach(() => vi.restoreAllMocks());

describe("modo de entrega", () => {
  it("padrao e gotrue; so 'elyra' exato liga o modo novo", () => {
    expect(recoveryDeliveryMode({})).toBe("gotrue");
    expect(recoveryDeliveryMode({ ELYRA_RECOVERY_DELIVERY: "elyra" })).toBe("elyra");
    expect(recoveryDeliveryMode({ ELYRA_RECOVERY_DELIVERY: "ELYRA" })).toBe("gotrue");
    expect(recoveryDeliveryMode({ ELYRA_RECOVERY_DELIVERY: "brevo" })).toBe("gotrue");
  });
});

describe("entrega", () => {
  it("conta existente: gera o link, monta a URL canonica e envia", async () => {
    const a = admin({ data: { properties: { hashed_token: TOKEN } } });
    const { t, sent } = transport();
    await expect(deliverRecoveryEmail("pessoa@example.invalid", { env: ENV, admin: a, transport: t })).resolves.toBe("sent");
    expect(a.auth.admin.generateLink).toHaveBeenCalledWith({ type: "recovery", email: "pessoa@example.invalid" });
    expect(sent).toHaveLength(1);
    const esperado = `http://localhost:3000${RECOVERY_CONFIRM_PATH}?token_hash=${TOKEN}`;
    expect(sent[0]!.to).toBe("pessoa@example.invalid");
    expect(sent[0]!.subject).toBe("Redefina sua senha da Elyra");
    expect(sent[0]!.body).toContain(esperado);
    expect(sent[0]!.html).toContain(esperado);
  });

  it("o host do link vem de ELYRA_PUBLIC_APP_URL, nunca da requisicao", async () => {
    const a = admin({ data: { properties: { hashed_token: TOKEN } } });
    const { t, sent } = transport();
    await deliverRecoveryEmail("p@example.invalid", {
      env: { ...ENV, ELYRA_PUBLIC_APP_URL: "https://elyra.example" },
      admin: a,
      transport: t,
    });
    expect(sent[0]!.body).toContain("https://elyra.example/redefinir-senha/confirmar?token_hash=");
  });

  it("conta inexistente: nada enviado", async () => {
    const { t, sent } = transport();
    const a = admin({ error: { status: 404, code: "user_not_found" } });
    await expect(deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: a, transport: t })).resolves.toBe("no_account");
    expect(sent).toHaveLength(0);
  });

  it("GoTrue fora do ar: link_failed, nada enviado", async () => {
    const { t, sent } = transport();
    await expect(
      deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: admin(new Error("ECONNREFUSED")), transport: t }),
    ).resolves.toBe("link_failed");
    expect(sent).toHaveLength(0);
  });

  it("token com forma inesperada nunca vira link", async () => {
    const { t, sent } = transport();
    const a = admin({ data: { properties: { hashed_token: "<script>" } } });
    await expect(deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: a, transport: t })).resolves.toBe("link_failed");
    expect(sent).toHaveLength(0);
  });

  it("falha do provedor: send_failed com codigo curto", async () => {
    const a = admin({ data: { properties: { hashed_token: TOKEN } } });
    const { t } = transport(async () => {
      throw new EmailTransportError("http_503");
    });
    await expect(deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: a, transport: t })).resolves.toBe("send_failed");
    expect(logs.join("\n")).toContain("code=http_503");
  });

  it.each([
    ["sem URL publica", { ...ENV, ELYRA_PUBLIC_APP_URL: undefined }, "unavailable_app_url"],
  ])("%s: indisponivel sem tentar", async (_n, env, esperado) => {
    const a = admin({ data: { properties: { hashed_token: TOKEN } } });
    const { t } = transport();
    await expect(deliverRecoveryEmail("x@example.invalid", { env, admin: a, transport: t })).resolves.toBe(esperado);
    expect(a.auth.admin.generateLink).not.toHaveBeenCalled();
  });

  it("sem transporte ou sem cliente de sistema: indisponivel", async () => {
    await expect(deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: admin({}), transport: null })).resolves.toBe(
      "unavailable_transport",
    );
    await expect(
      deliverRecoveryEmail("x@example.invalid", { env: ENV, admin: null, transport: transport().t }),
    ).resolves.toBe("unavailable_admin");
  });

  it("log nunca carrega endereco, token nem link", async () => {
    const a = admin({ data: { properties: { hashed_token: TOKEN } } });
    await deliverRecoveryEmail("segredo-pessoal@example.invalid", { env: ENV, admin: a, transport: transport().t });
    const tudo = logs.join("\n");
    expect(tudo).toContain("elyra.recovery_delivery outcome=sent provider=brevo");
    expect(tudo).not.toContain("segredo-pessoal");
    expect(tudo).not.toContain(TOKEN);
    expect(tudo).not.toContain("token_hash");
  });
});
