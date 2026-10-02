import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  type AuthActionState,
} from "@/lib/contracts/auth";



const h = vi.hoisted(() => ({ signIn: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword: h.signIn } }),
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.9" }),
}));
vi.mock("@/lib/security/rate-limit", async (original) => ({
  ...(await original<object>()),
  consumeRateLimit: () => ({ allowed: true, remaining: 9, retryAfterSeconds: 0 }),
}));

const { loginAction } = await import("./actions");

function entrar(): Promise<AuthActionState> {
  const data = new FormData();
  data.set("email", "public.professional@demo.invalid");
  data.set("password", "Synthetic-Login-Fixture!");
  data.set("context", "professional");
  return loginAction({ status: "idle" }, data);
}

let avisos: string[];
beforeEach(() => {
  h.signIn.mockReset();
  avisos = [];
  vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => avisos.push(a.map(String).join(" ")));
});
afterEach(() => vi.restoreAllMocks());

const mensagem = (s: AuthActionState) => (s.status === "error" ? s.message : null);

describe("falhas de login", () => {
  it("senha errada e conta inexistente: a mesma frase generica", async () => {
    h.signIn.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const a = await entrar();
    h.signIn.mockResolvedValueOnce({
      data: {},
      error: new AuthApiError("Invalid login credentials", 400, "invalid_credentials"),
    });
    const b = await entrar();
    expect(mensagem(a)).toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it.each([
    ["Supabase fora do ar (fetch falhou)", new AuthRetryableFetchError("fetch failed", 0)],
    ["gateway 502 (Auth parado atras do Kong)", new AuthApiError("Bad Gateway", 502, "unexpected_failure")],
    ["503", new AuthApiError("Service Unavailable", 503, "unexpected_failure")],
  ])("%s: diz que o servico nao respondeu, nao que a senha esta errada", async (_n, erro) => {
    h.signIn.mockResolvedValue({ data: {}, error: erro });
    const estado = await entrar();
    expect(mensagem(estado)).toBe(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    expect(mensagem(estado)).not.toBe(INVALID_CREDENTIALS_MESSAGE);
    expect(avisos.join("\n")).toContain("elyra.login_auth_unavailable");
    expect(avisos.join("\n")).not.toContain("public.professional");
  });

  it("429 do GoTrue e limite, e nao senha errada", async () => {
    h.signIn.mockResolvedValue({
      data: {},
      error: new AuthApiError("Request rate limit reached", 429, "over_request_rate_limit"),
    });
    expect(mensagem(await entrar())).toMatch(/Muitas tentativas/);
  });

  it("conta banida ou e-mail nao confirmado continuam genericos", async () => {
    for (const erro of [
      new AuthApiError("User is banned", 400, "user_banned"),
      new AuthApiError("Email not confirmed", 400, "email_not_confirmed"),
    ]) {
      h.signIn.mockResolvedValueOnce({ data: {}, error: erro });
      expect(mensagem(await entrar())).toBe(INVALID_CREDENTIALS_MESSAGE);
    }
  });
});
