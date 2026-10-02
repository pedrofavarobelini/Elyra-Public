import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ gate: vi.fn(), read: vi.fn(), write: vi.fn(), rate: vi.fn() }));
vi.mock("@/server/professional-gate", () => ({ getVerifiedProfessionalApiUser: mocks.gate }));
vi.mock("@/server/services/appointment-service", () => ({ getOwnAvailabilityWeek: mocks.read, updateOwnAvailabilityWeek: mocks.write }));
vi.mock("@/lib/security/rate-limit", () => ({ consumeRateLimit: mocks.rate, rateLimitIdentity: () => "qa", rateLimitedResponse: () => new Response(null, { status: 429 }) }));
import { GET, PUT } from "./route";
const authenticatedClient = {};
beforeEach(() => { vi.clearAllMocks(); mocks.gate.mockResolvedValue({ auth: { user: { id: "owner" }, supabase: authenticatedClient }, denial: null }); mocks.rate.mockReturnValue({ allowed: true }); mocks.read.mockResolvedValue({}); mocks.write.mockResolvedValue({}); });
describe("weekly availability API", () => {
  it("GET uses the authenticated client and disables caching", async () => {
    const result = await GET(new Request("https://elyra.invalid/api/scheduling/availability/week?week=2026-10-05"));
    expect(result.status).toBe(200); expect(result.headers.get("cache-control")).toBe("no-store");
    expect(mocks.read).toHaveBeenCalledWith(authenticatedClient, { weekStart: "2026-10-05", timezone: "America/Sao_Paulo" });
  });
  it.each([GET, PUT])("refuses unauthenticated/unverified users before touching the service", async (handler) => {
    mocks.gate.mockResolvedValue({ auth: null, denial: new Response(null, { status: 403 }) });
    expect((await handler(new Request("https://elyra.invalid"))).status).toBe(403);
    expect(mocks.read).not.toHaveBeenCalled(); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("PUT uses one service call, even when replacing or clearing all intervals", async () => {
    const body = { weekStart: "2026-10-05", intervals: [], blocks: [] };
    expect((await PUT(new Request("https://elyra.invalid", { method: "PUT", body: JSON.stringify(body) }))).status).toBe(200);
    expect(mocks.write).toHaveBeenCalledWith(authenticatedClient, body);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("limits reads and writes", async () => { mocks.rate.mockReturnValue({ allowed: false }); expect((await GET(new Request("https://elyra.invalid"))).status).toBe(429); expect(mocks.read).not.toHaveBeenCalled(); });
  it("bad JSON is a safe 400 response", async () => { expect((await PUT(new Request("https://elyra.invalid", { method: "PUT", body: "{" }))).status).toBe(400); });
});
