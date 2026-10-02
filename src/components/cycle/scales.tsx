import { Droplet } from "lucide-react";

import {
  FLOW_LABEL,
  FLOW_LEVELS,
  FLOW_RANK,
  SEVERITIES,
  SEVERITY_RANK,
  type Flow,
  type Severity,
} from "@/lib/contracts/cycle";
import { cn } from "@/lib/utils";

/**
 * Escala de intensidade de fluxo.
 *
 * `null` renderiza "Sem registro" - ausencia de registro nao e ausencia de
 * fluxo, e nenhuma das duas e zero.
 */
export function FlowScale({ value }: { value: Flow | null }) {
  if (value === null) {
    return <span className="text-sm text-ink-subtle">Sem registro</span>;
  }

  const rank = FLOW_RANK[value];

  return (
    <span className="flex items-center gap-2">
      <span
        className="flex items-center gap-0.5"
        role="img"
        aria-label={`Intensidade do fluxo: ${FLOW_LABEL[value]}, nível ${rank} de ${FLOW_LEVELS.length}`}
      >
        {FLOW_LEVELS.map((level) => (
          <Droplet
            key={level}
            aria-hidden="true"
            className={cn(
              "size-4",
              FLOW_RANK[level] <= rank
                ? "fill-cycle text-cycle"
                : "text-line-strong",
            )}
          />
        ))}
      </span>
      <span className="text-sm text-ink-muted">{FLOW_LABEL[value]}</span>
    </span>
  );
}

const SEVERITY_LABEL: Record<Severity, string> = {
  leve: "Leve",
  moderada: "Moderada",
  intensa: "Intensa",
};

/** Escala de severidade de sintoma: tres niveis, conforme escopo da V1. */
export function SeverityScale({ value }: { value: Severity }) {
  const rank = SEVERITY_RANK[value];

  return (
    <span className="flex items-center gap-3">
      <span
        className="flex items-center gap-1"
        role="img"
        aria-label={`Severidade: ${SEVERITY_LABEL[value]}, nível ${rank} de ${SEVERITIES.length}`}
      >
        {SEVERITIES.map((level) => (
          <span
            key={level}
            aria-hidden="true"
            className={cn(
              "size-2.5 rounded-pill",
              SEVERITY_RANK[level] <= rank ? "bg-cycle" : "bg-line-strong",
            )}
          />
        ))}
      </span>
      <span className="w-20 text-sm text-ink-muted">
        {SEVERITY_LABEL[value]}
      </span>
    </span>
  );
}

export { SEVERITY_LABEL };
