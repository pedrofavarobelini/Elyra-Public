

/** Uma linha de `audit_logs`, com o minimo que o relatorio precisa. */
export interface AuditRow {
  actor_user_id: string | null;
  action: string;
  outcome: string;
  occurred_at: string;
}

export interface DeletionRow {
  user_id: string;
  status: string;
  requested_at: string | null;
}

export interface ExpiredMediaRow {
  id: string;
  status: string;

  retention_until: string | null;
}

export interface HealthThresholds {
  /** Recusas do mesmo ator na janela a partir das quais vale olhar. */
  deniedPerActor: number;
  /** Horas que uma exclusao pode ficar sem concluir antes de virar alerta. */
  stuckDeletionHours: number;
}

export const DEFAULT_THRESHOLDS: HealthThresholds = {
  deniedPerActor: 20,
  stuckDeletionHours: 24,
};

export interface HealthInput {
  now: Date;
  windowHours: number;
  audit: readonly AuditRow[];
  deletions: readonly DeletionRow[];
  expiredMedia: readonly ExpiredMediaRow[];
  thresholds?: HealthThresholds;
}

export interface HealthReport {
  windowHours: number;
  totals: { audit: number; denied: number; failure: number };
  /** Acoes mais frequentes na janela, para ver mudanca de padrao. */
  topActions: { action: string; count: number }[];
  /** Atores com recusas acima do limiar — identificador truncado. */
  suspiciousActors: { actor: string; denied: number }[];
  stuckDeletions: { actor: string; status: string; hours: number }[];
  expiredMediaPending: number;
  alerts: string[];
  verdict: "OK" | "ATTENTION";
}

/** Identificador reduzido: suficiente para correlacionar, curto para nao expor. */
export function shortActor(id: string | null): string {
  return id ? id.slice(0, 8) : "anonimo";
}

function hoursBetween(now: Date, iso: string | null): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / 3_600_000;
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const thresholds = input.thresholds ?? DEFAULT_THRESHOLDS;
  const cutoff = input.now.getTime() - input.windowHours * 3_600_000;
  const inWindow = input.audit.filter((row) => {
    const at = Date.parse(row.occurred_at);
    return !Number.isNaN(at) && at >= cutoff;
  });

  const byAction = new Map<string, number>();
  const deniedByActor = new Map<string, number>();
  let denied = 0;
  let failure = 0;

  for (const row of inWindow) {
    byAction.set(row.action, (byAction.get(row.action) ?? 0) + 1);
    if (row.outcome === "denied") {
      denied += 1;
      const actor = shortActor(row.actor_user_id);
      deniedByActor.set(actor, (deniedByActor.get(actor) ?? 0) + 1);
    }
    if (row.outcome === "failure") failure += 1;
  }

  const topActions = [...byAction.entries()]
    .map(([action, count]) => ({ action, count }))
    .sort((a, b) => b.count - a.count || a.action.localeCompare(b.action))
    .slice(0, 5);

  const suspiciousActors = [...deniedByActor.entries()]
    .filter(([, count]) => count >= thresholds.deniedPerActor)
    .map(([actor, count]) => ({ actor, denied: count }))
    .sort((a, b) => b.denied - a.denied);

  const stuckDeletions = input.deletions
    .filter((row) => row.status !== "completed")
    .map((row) => ({
      actor: shortActor(row.user_id),
      status: row.status,
      hours: Math.floor(hoursBetween(input.now, row.requested_at) ?? 0),
    }))
    .filter((row) => row.hours >= thresholds.stuckDeletionHours)
    .sort((a, b) => b.hours - a.hours);

  const expiredMediaPending = input.expiredMedia.filter(
    (row) => row.status === "stored" && (hoursBetween(input.now, row.retention_until) ?? -1) > 0,
  ).length;

  const alerts: string[] = [];
  for (const actor of suspiciousActors) {
    alerts.push(`recusas_repetidas actor=${actor.actor} denied=${actor.denied}`);
  }
  for (const deletion of stuckDeletions) {
    alerts.push(`exclusao_parada actor=${deletion.actor} status=${deletion.status} horas=${deletion.hours}`);
  }
  if (expiredMediaPending > 0) {
    alerts.push(`midia_vencida_pendente total=${expiredMediaPending}`);
  }
  if (failure > 0) alerts.push(`falhas_registradas total=${failure}`);

  return {
    windowHours: input.windowHours,
    totals: { audit: inWindow.length, denied, failure },
    topActions,
    suspiciousActors,
    stuckDeletions,
    expiredMediaPending,
    alerts,
    verdict: alerts.length > 0 ? "ATTENTION" : "OK",
  };
}

/** Linhas de log do relatorio — sem conteudo, sem e-mail, sem id completo. */
export function formatHealthReport(report: HealthReport): string[] {
  const lines = [
    `OPS_HEALTH BEGIN window_hours=${report.windowHours}`,
    `OPS_HEALTH AUDIT total=${report.totals.audit} denied=${report.totals.denied} failure=${report.totals.failure}`,
  ];
  for (const action of report.topActions) {
    lines.push(`OPS_HEALTH ACTION action=${action.action} count=${action.count}`);
  }
  for (const alert of report.alerts) lines.push(`OPS_HEALTH ALERT ${alert}`);
  lines.push(
    `OPS_HEALTH=${report.verdict} denied=${report.totals.denied} alerts=${report.alerts.length}`,
  );
  return lines;
}
