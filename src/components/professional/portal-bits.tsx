import { AlertCircle, UserRound } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { RELATIONSHIP_STATUS_LABEL, type RelationshipStatus } from "@/lib/contracts/sharing";
import { cn } from "@/lib/utils";



/** Rotulos do ponto de vista do **profissional** (o do titular diz "por você"). */
export const RELATIONSHIP_STATUS_LABEL_PRO: Record<RelationshipStatus, string> = {
  pending: "Aguardando sua resposta",
  active: "Ativo",
  paused: "Pausado pela pessoa",
  revoked: "Encerrado pela pessoa",
  ended: "Encerrado por você",
};

const STATUS_TONE: Record<RelationshipStatus, "positive" | "attention" | "neutral" | "brand"> = {
  pending: "brand",
  active: "positive",
  paused: "attention",
  revoked: "neutral",
  ended: "neutral",
};

export function RelationshipStatusBadge({ status }: { status: RelationshipStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} data-relationship-status={status}>
      {RELATIONSHIP_STATUS_LABEL_PRO[status] ?? RELATIONSHIP_STATUS_LABEL[status]}
    </Badge>
  );
}

export function initialsOf(name: string | null) {
  if (!name) return "·";
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join("") || "·"
  );
}

/**
 * Pessoa acompanhada. Sem nome quando a RLS nao o devolve (vinculo nao ativo):
 * a tela diz por que, em vez de mostrar um UUID ou um "Desconhecido" ambiguo.
 */
export function PersonCell({
  name,
  caption,
  className,
}: {
  name: string | null;
  caption?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex min-w-0 items-center gap-3", className)}>
      <Avatar className="size-10 shrink-0">
        <AvatarFallback className="bg-brand-100 text-sm font-semibold text-brand-700">
          {name === null ? <UserRound className="size-4" aria-hidden="true" /> : initialsOf(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <p className="truncate font-medium text-ink">
          {name ?? "Pessoa acompanhada"}
        </p>
        <p className="truncate text-sm text-ink-muted">
          {name === null ? "Nome visível só com o vínculo ativo" : caption}
        </p>
      </div>
    </div>
  );
}

/** Falha de um bloco: diz o que nao carregou sem derrubar o resto da tela. */
export function BlockError({ what }: { what: string }) {
  return (
    <p
      role="alert"
      className="flex items-start gap-2 rounded-control bg-attention-soft px-4 py-3 text-sm text-ink"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
      <span>
        Não foi possível carregar {what}. Recarregue a página em alguns instantes.
      </span>
    </p>
  );
}
