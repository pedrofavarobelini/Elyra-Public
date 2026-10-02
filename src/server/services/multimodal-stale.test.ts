import { describe, expect, it, vi } from "vitest";

vi.mock("@/server/repositories/multimodal-repository", () => ({}));

import { STALE_SESSION_MS, isStaleSession } from "./multimodal-service";

describe("sessao presa em captura (OFF-3, L-407)", () => {
  const now = Date.parse("2026-09-28T18:00:00Z");
  const at = (msAgo: number) => new Date(now - msAgo).toISOString();

  it("so aberta e antiga demais: capturing/paused/preparing depois de 6 h", () => {
    for (const status of ["capturing", "paused", "preparing"]) {
      expect(isStaleSession({ status, started_at: at(STALE_SESSION_MS + 1) }, now), status).toBe(true);
      expect(isStaleSession({ status, started_at: at(STALE_SESSION_MS - 1) }, now), status).toBe(false);
    }
  });

  it("terminada nunca e reparada; data invalida nao dispara", () => {
    for (const status of ["completed", "cancelled", "error", "analyzed", "deleted"]) {
      expect(isStaleSession({ status, started_at: at(10 * STALE_SESSION_MS) }, now), status).toBe(false);
    }
    expect(isStaleSession({ status: "capturing", started_at: "x" }, now)).toBe(false);
  });

  it("a folga e muito maior que o teto de uma sessao (1 h): pausa legitima nao vira falha", () => {
    expect(STALE_SESSION_MS).toBeGreaterThanOrEqual(6 * 3_600_000);
  });
});
