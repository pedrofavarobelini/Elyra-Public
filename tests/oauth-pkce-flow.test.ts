// @vitest-environment node
import { createHash } from "node:crypto";
import type { CookieOptions } from "@supabase/ssr";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetRateLimits } from "@/lib/security/rate-limit";

// Cliente SSR, action, callback e guard reais; somente HTTP e o cookie store
// do Next sao simulados. Nenhuma conta/banco/provider real participa.
const h = vi.hoisted(() => ({
  host: "127.0.0.1:3000",
  jars: new Map<string, Map<string, { value: string; options: CookieOptions }>>(),
  redirect: "",
  challenge: "",
  exchangeVerified: false,
}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: h.host, origin: `http://${h.host}`, "x-forwarded-proto": "http", "x-elyra-path": "/dashboard" }),
  cookies: async () => {
    if (!h.jars.has(h.host)) h.jars.set(h.host, new Map());
    const jar = h.jars.get(h.host)!;
    return {
      getAll: () => [...jar].map(([name, cookie]) => ({ name, value: cookie.value })),
      set: (name: string, value: string, options: CookieOptions) => {
        if (options.maxAge === 0) jar.delete(name);
        else jar.set(name, { value, options });
      },
    };
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { h.redirect = path; throw new Error("NEXT_REDIRECT"); },
}));

const { signInWithGoogleAction } = await import("@/app/(auth)/actions");
const { GET } = await import("@/app/auth/callback/route");
const { getAuthenticatedUser, requireConsentedUser } = await import("@/server/auth");
const user = {
  id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee", aud: "authenticated", role: "authenticated",
  email: "synthetic@example.invalid", app_metadata: { provider: "google" }, user_metadata: {},
  created_at: "2026-09-13T00:00:00Z", email_confirmed_at: "2026-09-13T00:00:00Z",
};

beforeEach(() => {
  resetRateLimits(); h.jars.clear(); h.host = "127.0.0.1:3000";
  h.redirect = ""; h.challenge = ""; h.exchangeVerified = false;
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54381");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "synthetic-publishable-key");
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname === "/auth/v1/token") {
      const body = JSON.parse(String(init?.body));
      h.exchangeVerified = url.searchParams.get("grant_type") === "pkce" &&
        body.auth_code === "synthetic-code" && typeof body.code_verifier === "string" &&
        createHash("sha256").update(body.code_verifier).digest("base64url") === h.challenge;
      if (!h.exchangeVerified) return Response.json({ code: "bad_code_verifier", message: "synthetic mismatch" }, { status: 400 });
      const payload = Buffer.from(JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
        aal: "aal1",
      })).toString("base64url");
      return Response.json({ access_token: `eyJhbGciOiJIUzI1NiJ9.${payload}.c3ludGhldGlj`, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, user });
    }
    if (url.pathname === "/auth/v1/user") return Response.json(user);
    if (url.pathname === "/rest/v1/rpc/materialize_pending_consents") return Response.json(0);
    if (url.pathname === "/rest/v1/consent_events") return Response.json([]);
    if (url.pathname === "/rest/v1/app_lock_sessions") return Response.json([]);

    if (url.pathname === "/rest/v1/professional_profiles") return Response.json([]);

    if (url.pathname === "/rest/v1/professional_onboarding") return Response.json([]);
    throw new Error("Unexpected synthetic transport request");
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

async function start() {
  await expect(signInWithGoogleAction({ status: "idle" }, new FormData())).rejects.toThrow("NEXT_REDIRECT");
  const authorize = new URL(h.redirect);
  h.challenge = authorize.searchParams.get("code_challenge")!;
  expect(h.challenge).toBeTruthy();
  const callback = new URL(authorize.searchParams.get("redirect_to")!);
  expect(callback.origin).toBe("http://127.0.0.1:3000");
  expect(callback.pathname).toBe("/auth/callback");
  callback.searchParams.set("code", "synthetic-code");
  return callback;
}

it("preserva PKCE ate a troca, grava sessao e o servidor exige primeiro aceite Elyra", async () => {
  const callback = await start();
  const verifierCookies = [...h.jars.get(h.host)!].filter(([name]) => name.includes("code-verifier"));
  expect(verifierCookies.length).toBeGreaterThan(0);
  for (const [, cookie] of verifierCookies) {
    expect(cookie.options).toMatchObject({ path: "/", sameSite: "lax", secure: false, httpOnly: true });
    expect(cookie.options.domain).toBeUndefined();
  }
  const response = await GET(new NextRequest(callback, { headers: { host: h.host } }));
  expect(h.exchangeVerified).toBe(true);
  expect(response.headers.get("location")).toBe("/dashboard");
  expect([...h.jars.get(h.host)!.keys()].some(name => /-auth-token(?:\.\d+)?$/.test(name))).toBe(true);
  expect((await getAuthenticatedUser())?.user.id).toBe(user.id);
  await expect(requireConsentedUser()).rejects.toThrow("NEXT_REDIRECT");
  expect(h.redirect).toBe("/primeiro-acesso?next=%2Fdashboard");
});

it("cookie de outro host nao autentica e nao fabrica sessao", async () => {
  const callback = await start();
  h.host = "localhost:3000";
  const response = await GET(new NextRequest(callback, { headers: { host: h.host } }));
  expect(response.headers.get("location")).toBe("/entrar?oauth=falhou");
  expect(h.exchangeVerified).toBe(false);
  expect([...h.jars.get(h.host)!.keys()].some(name => /-auth-token(?:\.\d+)?$/.test(name))).toBe(false);
});
