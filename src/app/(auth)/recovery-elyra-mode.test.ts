import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_REQUESTED_MESSAGE, type RecoveryActionState } from "@/lib/contracts/auth";



const h = vi.hoisted(() => ({
  resetPasswordForEmail: vi.fn(),
  verifyOtp: vi.fn(),
  deliver: vi.fn(),
  after: vi.fn(),
  allow: new Map<string, boolean>(),
  identities: [] as Array<[string, string]>,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { resetPasswordForEmail: h.resetPasswordForEmail, verifyOtp: h.verifyOtp },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<object>()),
  after: (callback: () => unknown) => h.after(callback),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  },
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: (scope: string, identity: string) => {
    h.identities.push([scope, identity]);
    return { allowed: h.allow.get(scope) ?? true, remaining: 0, retryAfterSeconds: 0 };
  },
}));
vi.mock("@/server/services/recovery-delivery-service", async (original) => ({
  ...(await original<object>()),
  deliverRecoveryEmail: (email: string) => h.deliver(email),
}));

const { requestPasswordRecoveryAction, confirmRecoveryAction } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [k, v] of Object.entries(fields)) data.set(k, v);
  return data;
}

function pedir(email: string): Promise<RecoveryActionState> {
  return requestPasswordRecoveryAction({ status: "idle" }, form({ email }));
}

async function confirmar(tokenHash: string): Promise<string> {
  try {
    await confirmRecoveryAction(form({ token_hash: tokenHash }));
  } catch (error) {
    return (error as { url: string }).url;
  }
  throw new Error("esperava redirect");
}

const TOKEN = "a".repeat(56);
let logs: string[];

beforeEach(() => {
  vi.stubEnv("ELYRA_RECOVERY_DELIVERY", "elyra");
  h.resetPasswordForEmail.mockReset();
  h.verifyOtp.mockReset().mockResolvedValue({ data: {}, error: null });
  h.deliver.mockReset().mockResolvedValue("sent");
  h.after.mockReset();
  h.allow.clear();
  h.identities = [];
  logs = [];
  for (const level of ["info", "warn", "error", "log"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    });
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("pedido no modo elyra", () => {
  it("responde a mensagem neutra e agenda o envio para depois da resposta", async () => {
    const estado = await pedir("pessoa@example.invalid");
    expect(estado).toEqual({ status: "sent", message: RECOVERY_REQUESTED_MESSAGE });
    expect(h.after).toHaveBeenCalledTimes(1);
    // O envio ainda nao aconteceu: so roda quando o callback de `after` roda.
    expect(h.deliver).not.toHaveBeenCalled();
    await h.after.mock.calls[0]![0]();
    expect(h.deliver).toHaveBeenCalledWith("pessoa@example.invalid");
    expect(h.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it("conta existente, inexistente e falha do provedor: resposta byte a byte igual", async () => {
    const respostas: string[] = [];
    for (const desfecho of ["sent", "no_account", "send_failed"]) {
      h.deliver.mockResolvedValueOnce(desfecho);
      respostas.push(JSON.stringify(await pedir("alguem@example.invalid")));
      await h.after.mock.calls.at(-1)![0]();
    }
    expect(new Set(respostas).size).toBe(1);
  });

  it("erro inesperado no envio nao escapa do after nem muda a tela", async () => {
    h.deliver.mockRejectedValueOnce(new Error("boom"));
    const estado = await pedir("pessoa@example.invalid");
    await expect(h.after.mock.calls[0]![0]()).resolves.toBeUndefined();
    expect(estado.status).toBe("sent");
  });

  it("rate limit por IP vem antes de tudo", async () => {
    h.allow.set("passwordRecovery", false);
    const estado = await pedir("pessoa@example.invalid");
    expect(estado.status).toBe("error");
    expect(h.after).not.toHaveBeenCalled();
  });

  it("teto por destinatario: resposta igual, nenhum envio agendado", async () => {
    h.allow.set("passwordRecoveryRecipient", false);
    const estado = await pedir("pessoa@example.invalid");
    expect(estado).toEqual({ status: "sent", message: RECOVERY_REQUESTED_MESSAGE });
    expect(h.after).not.toHaveBeenCalled();
  });

  it("a chave do balde por destinatario e hash, nunca o endereco", async () => {
    await pedir("Pessoa@Exemplo.com");
    const recipient = h.identities.find(([scope]) => scope === "passwordRecoveryRecipient");
    expect(recipient?.[1]).toMatch(/^rcpt:[0-9a-f]{64}$/);
    expect(recipient?.[1]).not.toContain("exemplo");
  });

  it("modo gotrue continua usando o GoTrue e nao agenda envio da Elyra", async () => {
    vi.stubEnv("ELYRA_RECOVERY_DELIVERY", "gotrue");
    h.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    await pedir("pessoa@example.invalid");
    expect(h.resetPasswordForEmail).toHaveBeenCalledTimes(1);
    expect(h.after).not.toHaveBeenCalled();
  });

  it("nada do endereco aparece em log", async () => {
    await pedir("segredo-pessoal@example.invalid");
    await h.after.mock.calls[0]![0]();
    expect(logs.join("\n")).not.toContain("segredo-pessoal");
  });
});

describe("confirmacao do link", () => {
  it("token valido: troca como recovery e segue para criar a senha", async () => {
    await expect(confirmar(TOKEN)).resolves.toBe("/redefinir-senha");
    expect(h.verifyOtp).toHaveBeenCalledWith({ token_hash: TOKEN, type: "recovery" });
  });

  it.each([
    ["vazio", ""],
    ["nao hexadecimal", "z".repeat(56)],
    ["curto", "ab12"],
    ["com injecao", `${"a".repeat(40)}' or 1=1 --`],
    ["longo demais", "a".repeat(400)],
  ])("token %s nem chega ao GoTrue", async (_nome, token) => {
    await expect(confirmar(token)).resolves.toBe("/recuperar-senha?erro=link_invalido");
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });

  it("expirado, ja usado ou forjado: mesmo destino, sem token no log", async () => {
    h.verifyOtp.mockResolvedValue({ data: {}, error: { status: 403, code: "otp_expired" } });
    await expect(confirmar(TOKEN)).resolves.toBe("/recuperar-senha?erro=link_invalido");
    expect(logs.join("\n")).not.toContain(TOKEN);
  });

  it("rate limit da redefinicao vale para a confirmacao", async () => {
    h.allow.set("passwordReset", false);
    await expect(confirmar(TOKEN)).resolves.toBe("/recuperar-senha?erro=link_invalido");
    expect(h.verifyOtp).not.toHaveBeenCalled();
  });
});
