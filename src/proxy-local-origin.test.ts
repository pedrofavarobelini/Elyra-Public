// @vitest-environment node
import { NextRequest, NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ updateSession: vi.fn() }));
vi.mock("@/lib/supabase/proxy", () => ({ updateSession: h.updateSession }));
const { proxy } = await import("./proxy");

beforeEach(() => {
  vi.stubEnv("ELYRA_RUNTIME_ENV", "qa");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54381");
  h.updateSession.mockReset().mockResolvedValue(NextResponse.next());
});
afterEach(() => vi.unstubAllEnvs());

describe("origem local antes de qualquer cookie", () => {
  it.each([3000, 3100])("canonicaliza 127.0.0.1:%s antes de criar cliente", async (port) => {
    const response = await proxy(new NextRequest(`http://127.0.0.1:${port}/entrar?oauth=falhou`, {
      headers: { host: `127.0.0.1:${port}`, "sec-fetch-mode": "navigate" },
    }));
    // Sem Location: o adapter do Next o tornaria relativo e o navegador ficaria no IP.
    expect(response.status).toBe(200);
    expect(response.headers.has("location")).toBe(false);
    expect(response.headers.get("refresh")).toBe(`0;url=http://localhost:${port}/entrar?oauth=falhou`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain(`href="http://localhost:${port}/entrar?oauth=falhou"`);
    expect(response.headers.has("set-cookie")).toBe(false);
    expect(h.updateSession).not.toHaveBeenCalled();
  });

  it("escapa a URL de destino no HTML", async () => {
    const response = await proxy(new NextRequest(`http://127.0.0.1:3000/entrar?next="><script>x</script>&a='b'`, {
      headers: { host: "127.0.0.1:3000", accept: "text/html" },
    }));
    const html = await response.text();
    expect(html).not.toContain("<script>");
    expect(html).not.toMatch(/url=[^"]*"[^>]*>[^<]*<script/);
    expect(html).toContain("&amp;a=");
    expect(response.headers.get("refresh")).toMatch(/^0;url=http:\/\/localhost:3000\/entrar\?/);
  });

  it("responde 421 sem corpo a fetch/API no host errado", async () => {
    const response = await proxy(new NextRequest("http://127.0.0.1:3000/api/me/export", {
      headers: { host: "127.0.0.1:3000", accept: "application/json" },
    }));
    expect(response.status).toBe(421);
    expect(response.headers.has("location")).toBe(false);
    expect(await response.text()).toBe("");
    expect(h.updateSession).not.toHaveBeenCalled();
  });

  it("nao cria loop quando Next normaliza o IP em request.url", async () => {
    const request = new NextRequest("http://localhost:3000/entrar", {
      headers: { host: "localhost:3000", "x-forwarded-host": "127.0.0.1:3000" },
    });
    expect(new URL(request.url).hostname).toBe("localhost");
    await proxy(request);
    expect(h.updateSession).toHaveBeenCalledOnce();
  });

  it("descarta POST de aba antiga em vez de reenviar a action entre hosts", async () => {
    const response = await proxy(new NextRequest("http://127.0.0.1:3000/entrar", {
      method: "POST", headers: { host: "127.0.0.1:3000" }, body: "fixture",
    }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/entrar");
    expect(h.updateSession).not.toHaveBeenCalled();
  });

  it.each(["production", "staging", "development"])("preserva ambiente %s", async (runtime) => {
    vi.stubEnv("ELYRA_RUNTIME_ENV", runtime);
    await proxy(new NextRequest("http://localhost:3000/entrar", { headers: { host: "localhost:3000" } }));
    expect(h.updateSession).toHaveBeenCalledOnce();
  });

  it.each(["qa.example", "localhost.evil:3000", "localhost:4000"])("nao canonicaliza host %s", async (host) => {
    await proxy(new NextRequest("http://localhost:3000/entrar", { headers: { host } }));
    expect(h.updateSession).toHaveBeenCalledOnce();
  });

  it("preserva tunel HTTPS e Supabase remoto", async () => {
    await proxy(new NextRequest("http://localhost:3000/entrar", {
      headers: { host: "localhost:3000", "x-forwarded-proto": "https" },
    }));
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://qa.example");
    await proxy(new NextRequest("http://localhost:3000/entrar", { headers: { host: "localhost:3000" } }));
    expect(h.updateSession).toHaveBeenCalledTimes(2);
  });
});
