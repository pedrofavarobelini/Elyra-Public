import { describe, expect, it } from "vitest";

import {
  buildHealthReport,
  formatHealthReport,
  shortActor,
  type AuditRow,
} from "@/server/ops/health-report";



const now = new Date("2026-09-17T20:00:00.000Z");
const actorA = "aaaaaaaa-1111-4111-8111-111111111111";
const actorB = "bbbbbbbb-2222-4222-8222-222222222222";

function audit(rows: Partial<AuditRow>[]): AuditRow[] {
  return rows.map((row) => ({
    actor_user_id: row.actor_user_id ?? actorA,
    action: row.action ?? "journal_entry.update",
    outcome: row.outcome ?? "success",
    occurred_at: row.occurred_at ?? "2026-09-17T19:30:00.000Z",
  }));
}

describe("relatorio operacional de saude", () => {
  it("fora da janela nao conta", () => {
    const report = buildHealthReport({
      now,
      windowHours: 1,
      audit: audit([{ occurred_at: "2026-09-16T10:00:00.000Z" }]),
      deletions: [],
      expiredMedia: [],
    });
    expect(report.totals.audit).toBe(0);
    expect(report.verdict).toBe("OK");
  });

  it("recusas repetidas do mesmo ator viram alerta; uso normal nao", () => {
    const denied = audit(Array.from({ length: 25 }, () => ({ outcome: "denied" })));
    const normal = audit(Array.from({ length: 40 }, () => ({ actor_user_id: actorB })));
    const report = buildHealthReport({
      now,
      windowHours: 24,
      audit: [...denied, ...normal],
      deletions: [],
      expiredMedia: [],
    });
    expect(report.suspiciousActors).toEqual([{ actor: "aaaaaaaa", denied: 25 }]);
    expect(report.verdict).toBe("ATTENTION");
    expect(report.topActions[0]?.count).toBe(65);
  });

  it("identificador e truncado: correlaciona sem expor a pessoa inteira", () => {
    expect(shortActor(actorA)).toBe("aaaaaaaa");
    expect(shortActor(null)).toBe("anonimo");
  });

  it("exclusao parada e midia vencida aparecem; concluida e recente nao", () => {
    const report = buildHealthReport({
      now,
      windowHours: 24,
      audit: [],
      deletions: [
        { user_id: actorA, status: "storage_cleared", requested_at: "2026-09-15T10:00:00.000Z" },
        { user_id: actorB, status: "completed", requested_at: "2026-09-10T10:00:00.000Z" },
        { user_id: actorB, status: "requested", requested_at: "2026-09-17T19:00:00.000Z" },
      ],
      expiredMedia: [
        { id: "1", status: "stored", retention_until: "2026-09-16T10:00:00.000Z" },
        { id: "2", status: "stored", retention_until: "2026-09-30T10:00:00.000Z" },
        { id: "3", status: "deleted", retention_until: "2026-09-01T10:00:00.000Z" },
      ],
    });
    expect(report.stuckDeletions).toEqual([
      { actor: "aaaaaaaa", status: "storage_cleared", hours: 58 },
    ]);
    expect(report.expiredMediaPending).toBe(1);
  });

  it("as linhas do relatorio nao carregam conteudo nem identificador inteiro", () => {
    const report = buildHealthReport({
      now,
      windowHours: 24,
      audit: audit([{ outcome: "failure" }]),
      deletions: [],
      expiredMedia: [],
    });
    const text = formatHealthReport(report).join("\n");
    expect(text).toContain("OPS_HEALTH=ATTENTION");
    expect(text).not.toContain(actorA);
    expect(text).not.toMatch(/@|senha|token|diario|conteudo/i);
  });
});
