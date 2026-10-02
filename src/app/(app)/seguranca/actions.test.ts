import { beforeEach, describe, expect, it, vi } from "vitest";



const h = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  signOut: vi.fn(),
  appendAudit: vi.fn(),
  consumeRateLimit: vi.fn(),
}));

vi.mock("@/server/auth", () => ({
  requireAuthenticatedUser: h.requireAuthenticatedUser,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: (scope: string, identity: string) =>
    h.consumeRateLimit(scope, identity),
}));
vi.mock("@/server/repositories/identity-repository", () => ({
  appendAudit: h.appendAudit,
}));

const { signOutOtherSessionsAction } = await import("./actions");

const run = () => signOutOtherSessionsAction();

beforeEach(() => {
  h.requireAuthenticatedUser.mockReset();
  h.signOut.mockReset();
  h.appendAudit.mockReset();
  h.consumeRateLimit.mockReset();
  h.requireAuthenticatedUser.mockResolvedValue({
    supabase: { auth: { signOut: h.signOut } },
    user: { id: "u-1" },
  });
  h.signOut.mockResolvedValue({ error: null });
  h.appendAudit.mockResolvedValue(undefined);
  h.consumeRateLimit.mockReturnValue({ allowed: true });
});

describe("signOutOtherSessionsAction", () => {
  it("revoga com escopo others e mantem este aparelho", async () => {
    const state = await run();

    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(state).toEqual({
      status: "done",
      message: expect.stringContaining("Este aparelho continua conectado"),
    });
  });

  it("registra auditoria sem conteudo, chaveada no proprio usuario", async () => {
    await run();

    expect(h.appendAudit).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        actorUserId: "u-1",
        action: "auth.sessions.others_revoked",
        entityType: "auth_session",
        entityId: "u-1",
      }),
    );
    expect(h.consumeRateLimit).toHaveBeenCalledWith("auth", "user:u-1");
  });

  it("sem sessao ou com App Lock nao chega ao provedor", async () => {
    h.requireAuthenticatedUser.mockRejectedValue(new Error("redirect_gate"));

    await expect(run()).rejects.toThrow("redirect_gate");
    expect(h.signOut).not.toHaveBeenCalled();
  });

  it("falha do provedor aparece como erro, e nao como sucesso", async () => {
    h.signOut.mockResolvedValue({ error: new Error("gotrue_down") });

    const state = await run();

    expect(state.status).toBe("error");
    expect(h.appendAudit).not.toHaveBeenCalled();
  });

  it("limite excedido nao revoga", async () => {
    h.consumeRateLimit.mockReturnValue({ allowed: false });

    const state = await run();

    expect(h.signOut).not.toHaveBeenCalled();
    expect(state.status).toBe("error");
  });

  it("falha de auditoria nao desfaz a revogacao ja feita", async () => {
    h.appendAudit.mockRejectedValue(new Error("audit_down"));

    const state = await run();

    expect(h.signOut).toHaveBeenCalledWith({ scope: "others" });
    expect(state.status).toBe("done");
  });
});
