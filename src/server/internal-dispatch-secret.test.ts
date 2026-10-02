import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  MIN_DISPATCH_SECRET_LENGTH,
  dispatchSecretConfigured,
  requireInternalDispatchSecret,
} from "@/server/internal-dispatch-secret";

const SECRET = "s".repeat(MIN_DISPATCH_SECRET_LENGTH);
const env = { ELYRA_DISPATCH_SECRET: SECRET };

describe("segredo das rotas de sistema", () => {
  it("sem segredo configurado, nenhuma credencial passa", () => {
    expect(dispatchSecretConfigured({})).toBe(false);
    expect(requireInternalDispatchSecret(`Bearer ${SECRET}`, {})).toBe(false);
  });
  it("segredo curto conta como ausente", () => {
    const curto = { ELYRA_DISPATCH_SECRET: "s".repeat(MIN_DISPATCH_SECRET_LENGTH - 1) };
    expect(dispatchSecretConfigured(curto)).toBe(false);
    expect(requireInternalDispatchSecret(`Bearer ${curto.ELYRA_DISPATCH_SECRET}`, curto)).toBe(false);
  });
  it("aceita so o Bearer exato", () => {
    expect(requireInternalDispatchSecret(`Bearer ${SECRET}`, env)).toBe(true);
    expect(requireInternalDispatchSecret(SECRET, env)).toBe(false);
    expect(requireInternalDispatchSecret(`Basic ${SECRET}`, env)).toBe(false);
    expect(requireInternalDispatchSecret(`Bearer ${SECRET}x`, env)).toBe(false);
    expect(requireInternalDispatchSecret(`Bearer ${SECRET.slice(1)}`, env)).toBe(false);
    expect(requireInternalDispatchSecret("Bearer ", env)).toBe(false);
    expect(requireInternalDispatchSecret(null, env)).toBe(false);
  });
});
