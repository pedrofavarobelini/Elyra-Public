import { describe, expect, it } from "vitest";
import { resolveEvidenceStage } from "./evidence-stage";
describe("isolated public QA output", () => {
  it("works without an engineering archive", () => expect(resolveEvidenceStage({})).toBe("public-snapshot"));
  it("preserves a validated run name", () => expect(resolveEvidenceStage({ ELYRA_EVIDENCE_RUN: "run-12" })).toBe("run-12"));
  it.each(["../outside", "/absolute", "C:\\private", "a/b", ".git"])("rejects unsafe path %s", (value) => expect(() => resolveEvidenceStage({ ELYRA_EVIDENCE_RUN: value })).toThrow());
});
