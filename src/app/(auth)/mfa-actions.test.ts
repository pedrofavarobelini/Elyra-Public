import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getUser: vi.fn(),
  listFactors: vi.fn(),
  challenge: vi.fn(),
  verify: vi.fn(),
  appendAudit: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: h.getUser,
      mfa: {
        listFactors: h.listFactors,
        challenge: h.challenge,
        verify: h.verify,
      },
    },
  }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.10" }),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: (scope: string, identity: string) =>
    h.consumeRateLimit(scope, identity),
}));
vi.mock("@/server/repositories/identity-repository", () => ({
  appendAudit: h.appendAudit,
}));

const { verifyMfaChallengeAction } = await import("./mfa-actions");

function code(value = "123456") {
  const data = new FormData();
  data.set("code", value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.getUser.mockResolvedValue({ data: { user: { id: "account-a" } }, error: null });
  h.listFactors.mockResolvedValue({
    data: { totp: [{ id: "factor-a", status: "verified" }] },
    error: null,
  });
  h.challenge.mockResolvedValue({ data: { id: "challenge-a" }, error: null });
  h.verify.mockResolvedValue({ data: {}, error: null });
  h.appendAudit.mockResolvedValue(undefined);
  h.consumeRateLimit.mockReturnValue({ allowed: true });
});

describe("challenge TOTP no login", () => {
  it("não consulta a sessão para código malformado", async () => {
    const result = await verifyMfaChallengeAction({ status: "idle" }, code("12ab"));

    expect(result.status).toBe("error");
    expect(h.getUser).not.toHaveBeenCalled();
  });

  it("nega quando não existe sessão autenticada", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });

    const result = await verifyMfaChallengeAction({ status: "idle" }, code());

    expect(result.status).toBe("error");
    expect(h.verify).not.toHaveBeenCalled();
  });

  it("falha fechado quando a lista de fatores fica indisponível", async () => {
    h.listFactors.mockResolvedValue({ data: null, error: new Error("provider down") });

    const result = await verifyMfaChallengeAction({ status: "idle" }, code());

    expect(result.status).toBe("error");
    expect(h.challenge).not.toHaveBeenCalled();
  });

  it("não cria desafio quando não há TOTP verificado", async () => {
    h.listFactors.mockResolvedValue({
      data: { totp: [{ id: "factor-a", status: "unverified" }] },
      error: null,
    });

    const result = await verifyMfaChallengeAction({ status: "idle" }, code());

    expect(result.status).toBe("error");
    expect(h.challenge).not.toHaveBeenCalled();
  });

  it("código recusado não produz estado de autenticação", async () => {
    h.verify.mockResolvedValue({ data: null, error: new Error("invalid code") });

    const result = await verifyMfaChallengeAction({ status: "idle" }, code());

    expect(result.status).toBe("error");
    expect(h.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ actorUserId: "account-a", outcome: "denied" }),
    );
  });

  it("só devolve verified depois do challenge confirmado pelo provedor", async () => {
    const result = await verifyMfaChallengeAction({ status: "idle" }, code("123 456"));

    expect(h.verify).toHaveBeenCalledWith({
      factorId: "factor-a",
      challengeId: "challenge-a",
      code: "123456",
    });
    expect(result).toEqual({ status: "verified" });
  });

  it("rate limit é separado por usuário e impede o challenge", async () => {
    h.consumeRateLimit.mockReturnValue({ allowed: false });

    const result = await verifyMfaChallengeAction({ status: "idle" }, code());

    expect(h.consumeRateLimit).toHaveBeenCalledWith("auth", "user:account-a");
    expect(result.status).toBe("error");
    expect(h.listFactors).not.toHaveBeenCalled();
  });
});
