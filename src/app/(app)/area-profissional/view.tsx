import {
  BadgeCheck,
  ClipboardCheck,
  FileSearch,
  ShieldAlert,
  ShieldCheck,
  UserRoundCheck,
  type LucideIcon,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { ONBOARDING_STEPS } from "@/lib/contracts/professional-onboarding";
import {
  PROFESSIONAL_STATE_DESCRIPTION,
  PROFESSIONAL_STATE_LABEL,
  PROFESSIONAL_STATE_POLICY,
  type ProfessionalState,
} from "@/lib/contracts/professional-state";
import {
  VERIFICATION_LABEL,
  VERIFICATION_REASON_LABEL,
  type VerificationStatus,
} from "@/lib/contracts/professional-verification";
import { formatDate, formatDateTime } from "@/lib/professional/portal";
import { InlineEmpty } from "@/components/states";

interface HistoryEvent {
  id: string;
  to_status: string;
  reason_code: string;
  occurred_at: string;
}

const TONE: Record<ProfessionalState, "positive" | "attention" | "destructive" | "identity" | "neutral"> = {
  NO_PROFILE: "neutral",
  ONBOARDING: "identity",
  UNDER_AUTOMATED_REVIEW: "identity",
  PENDING_CORRECTION: "attention",
  VERIFIED: "positive",
  REJECTED: "destructive",
  SUSPENDED: "destructive",
  EXPIRED_REVIEW: "attention",
};

const HOW_IT_WORKS: Array<{ icon: LucideIcon; title: string; text: string }> = [
  {
    icon: UserRoundCheck,
    title: "Você se cadastra",
    text: "Com a mesma conta da Elyra. Registro no conselho, formação e como você atua.",
  },
  {
    icon: ClipboardCheck,
    title: "Checagem automática",
    text: "A Elyra confere formato e consistência. Ela não aprova nem recusa sozinha: quem decide é a conferência humana.",
  },
  {
    icon: FileSearch,
    title: "Conferência na fonte oficial",
    text: "Uma pessoa da equipe consulta o registro no conselho. Só então a área profissional abre.",
  },
];

/**
 * Area profissional (F1): o estado, o proximo passo e o historico. Nada aqui
 * libera o portal — isso e do servidor, por estado.
 */
export function ProfessionalAreaView({
  state,
  registration,
  progress,
  history,
  historyAvailable,
}: {
  state: ProfessionalState;
  registration: {
    council: string;
    region: string | null;
    number: string;
    reviewedAt: string | null;
    reviewDueAt: string | null;
  } | null;
  progress: { completed: string[]; currentStep: string | null; submittedAt: string | null };
  history: HistoryEvent[];
  historyAvailable: boolean;
}) {
  const policy = PROFESSIONAL_STATE_POLICY[state];
  const verified = state === "VERIFIED";
  const blocked = state === "REJECTED" || state === "SUSPENDED";
  const StateIcon = verified ? ShieldCheck : blocked ? ShieldAlert : BadgeCheck;
  const doneCount = ONBOARDING_STEPS.filter((step) => progress.completed.includes(step)).length;
  const lastReason = history[0]?.reason_code;

  return (
    <>
      <PageHeader
        title="Área profissional"
        description="Seu cadastro como profissional, com a mesma conta, o mesmo login e a mesma segurança."
      />

      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          <Card variant="hero" className="overflow-hidden" data-testid="professional-state-card" data-professional-state={state}>
            <div className="bg-gradient-to-br from-identity-50 via-surface to-brand-50 p-5 sm:p-6">
              <div className="flex items-start gap-4">
                <IconPill tone={verified ? "positive" : blocked ? "attention" : "identity"} size="lg">
                  <StateIcon aria-hidden="true" />
                </IconPill>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold tracking-tight text-ink">{PROFESSIONAL_STATE_LABEL[state]}</h2>
                    {registration ? (
                      <Badge tone={TONE[state]}>
                        {registration.council} {registration.region ?? "--"}/{registration.number}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-1.5 max-w-prose text-sm text-ink-muted" data-testid="professional-state-description">
                    {PROFESSIONAL_STATE_DESCRIPTION[state]}
                  </p>
                </div>
              </div>

              {state === "PENDING_CORRECTION" && lastReason ? (
                <p className="mt-4 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink" role="status">
                  <span className="font-medium">O que corrigir: </span>
                  {VERIFICATION_REASON_LABEL[lastReason] ?? "Revise as informações do cadastro."}
                </p>
              ) : null}

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-control bg-surface/80 px-3.5 py-3">
                  <dt className="text-xs text-ink-muted">Próximo passo</dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">{policy.regularization}</dd>
                </div>
                <div className="rounded-control bg-surface/80 px-3.5 py-3">
                  <dt className="text-xs text-ink-muted">
                    {verified ? "Validade da conferência" : registration ? "Envio" : "Cadastro"}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium text-ink">
                    {verified && registration?.reviewDueAt
                      ? `Até ${formatDate(registration.reviewDueAt)}`
                      : progress.submittedAt
                        ? `Enviado em ${formatDate(progress.submittedAt)}`
                        : `${doneCount} de ${ONBOARDING_STEPS.length} etapas`}
                  </dd>
                </div>
              </dl>

              <div className="mt-5 flex flex-wrap gap-2">
                {policy.cta && policy.cta.href !== "/area-profissional" ? (
                  <Button asChild>
                    <Link href={policy.cta.href as Route} data-testid="professional-area-cta">
                      {policy.cta.label}
                    </Link>
                  </Button>
                ) : null}
                {!verified && state !== "SUSPENDED" && state !== "NO_PROFILE" && state !== "ONBOARDING" ? (
                  <Button asChild variant="secondary">
                    <Link href={"/area-profissional/cadastro?etapa=revisao" as Route}>Ver meu cadastro</Link>
                  </Button>
                ) : null}
              </div>
            </div>
          </Card>

          {registration ? (
            <Card>
              <CardHeader>
                <CardTitle as="h2">Histórico da verificação</CardTitle>
                <CardDescription>O que mudou e por quê. Quem revisou não aparece aqui.</CardDescription>
              </CardHeader>
              <CardContent>
                {!historyAvailable ? (
                  <BlockError what="o histórico da verificação" />
                ) : history.length === 0 ? (
                  <InlineEmpty>Nenhum evento ainda.</InlineEmpty>
                ) : (
                  <ol className="flex flex-col gap-3" data-testid="verification-history">
                    {history.map((event) => (
                      <li key={event.id} className="flex gap-3">
                        <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-identity-500" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink">
                            {VERIFICATION_LABEL[event.to_status as VerificationStatus] ?? event.to_status}
                          </p>
                          <p className="text-xs text-ink-muted">
                            {VERIFICATION_REASON_LABEL[event.reason_code] ?? "Mudança registrada"} ·{" "}
                            <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          <Card>
            <CardHeader>
              <CardTitle as="h2">Como a verificação funciona</CardTitle>
              <CardDescription>
                Verificar confirma as informações apresentadas. Não é avaliação da qualidade profissional.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="flex flex-col gap-4">
                {HOW_IT_WORKS.map((item, index) => (
                  <li key={item.title} className="flex gap-3">
                    <IconPill tone="brand" size="sm">
                      <item.icon aria-hidden="true" />
                    </IconPill>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink">
                        <span className="sr-only">Passo {index + 1}: </span>
                        {item.title}
                      </p>
                      <p className="text-sm text-ink-muted">{item.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card variant="muted">
            <CardContent className="pt-5">
              <p className="text-sm font-medium text-ink">O que a Elyra não pede</p>
              <p className="mt-1 text-sm text-ink-muted">
                CPF, RG, endereço residencial ou foto de documento. Seu nome e seu registro no conselho bastam para a
                conferência na fonte oficial.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
