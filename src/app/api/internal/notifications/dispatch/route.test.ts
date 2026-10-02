// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const h = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("@/server/jobs/notification-email-dispatcher", () => ({
  dispatchNotificationEmails: h.dispatch,
}));

import { resetRateLimits } from "@/lib/security/rate-limit";

const { POST } = await import("./route");
const SECRET = "k".repeat(48);

function req(authorization?: string, ip = "198.51.100.9") {
  return new Request("http://localhost:3000/api/internal/notifications/dispatch", {
    method: "POST",
    headers: { ...(authorization ? { authorization } : {}), "x-forwarded-for": ip },
  });
}

beforeEach(() => {
  resetRateLimits();
  vi.stubEnv("ELYRA_DISPATCH_SECRET", SECRET);
  h.dispatch.mockReset().mockResolvedValue({
    status: "completed", runId: "r", transport: "mailpit", selected: 1, delivered: 1, suppressed: 0, failed: 0,
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("rota interna do dispatcher", () => {
  it("sem segredo: 404 como rota inexistente, e nada roda", async () => {
    const r = await POST(req());
    expect(r.status).toBe(404);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it("segredo errado: 404", async () => {
    expect((await POST(req("Bearer errado"))).status).toBe(404);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
  it("servidor sem segredo configurado: 404 mesmo com cabecalho", async () => {
    vi.stubEnv("ELYRA_DISPATCH_SECRET", "");
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(404);
  });
  it("segredo certo: roda e devolve so contagens, sem cache", async () => {
    const r = await POST(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    const body = await r.json();
    expect(body.data).toMatchObject({ status: "completed", delivered: 1 });
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });
  it("dispatcher indisponivel responde 503", async () => {
    h.dispatch.mockResolvedValue({ status: "unavailable", reason: "transport_missing" });
    expect((await POST(req(`Bearer ${SECRET}`))).status).toBe(503);
  });
  it("forca bruta no segredo esbarra no rate limit antes de comparar", async () => {
    for (let i = 0; i < 12; i += 1) await POST(req("Bearer chute"));
    const r = await POST(req(`Bearer ${SECRET}`));
    expect(r.status).toBe(429);
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});
