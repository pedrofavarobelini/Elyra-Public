import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { supportContentPreviewEnabled } from "./preview";

const local = { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381" };

describe("pre-visualizacao editorial (REVIEW nunca em producao)", () => {
  it("desligada por padrao", () => {
    expect(supportContentPreviewEnabled({ ...local, NODE_ENV: "development" })).toBe(false);
  });

  it("liga so com flag explicita + fora de producao (ou QA) + Supabase local", () => {
    expect(supportContentPreviewEnabled({ ...local, NODE_ENV: "development", ELYRA_SUPPORT_CONTENT_PREVIEW: "review" })).toBe(true);
    expect(
      supportContentPreviewEnabled({ ...local, NODE_ENV: "production", ELYRA_RUNTIME_ENV: "qa", ELYRA_SUPPORT_CONTENT_PREVIEW: "review" }),
    ).toBe(true);
  });

  it("producao real nunca pre-visualiza, mesmo com a flag", () => {
    expect(supportContentPreviewEnabled({ ...local, NODE_ENV: "production", ELYRA_SUPPORT_CONTENT_PREVIEW: "review" })).toBe(false);
    expect(
      supportContentPreviewEnabled({
        NODE_ENV: "production",
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_SUPPORT_CONTENT_PREVIEW: "review",
        NEXT_PUBLIC_SUPABASE_URL: "https://abc.example.invalid",
      }),
    ).toBe(false);
    expect(supportContentPreviewEnabled({ ...local, NODE_ENV: "development", ELYRA_SUPPORT_CONTENT_PREVIEW: "true" })).toBe(false);
  });
});
