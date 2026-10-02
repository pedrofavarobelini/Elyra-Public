"use client";

import { CalendarClock, ScanFace, UserRoundSearch, Video } from "lucide-react";
import Link from "next/link";

import { useViewerTimezone } from "@/components/scheduling/appointment-list";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { IconPill } from "@/components/ui/icon-pill";
import { MODALITY_LABEL, type Modality } from "@/lib/contracts/scheduling";
import { formatDayHeading, formatTime } from "@/lib/scheduling/format";
import { InlineEmpty } from "@/components/states";

export interface NextProfessionalSession {
  /** Sessao PRO-7 (sala); ausente quando so ha o horario confirmado. */
  sessionId: string | null;
  professionalName: string | null;
  startsAt: string;
  opensAt: string | null;
  modality: Modality;
  timezone: string;
}

/**
 * Entrada unificada de Sessoes (ADR-0029). Dois caminhos, e cada cartao diz
 * QUEM ve o que: a sessao particular e so da pessoa; a sessao com profissional
 * e uma chamada, e nada e registrado sem permissao dela.
 */
export function SessionsHub({
  now,
  hasProfessional,
  next,
  professionalAvailable,
}: {
  now: string;
  hasProfessional: boolean;
  next: NextProfessionalSession | null;
  /** false quando os dados da agenda nao carregaram (nao finge "sem vinculo"). */
  professionalAvailable: boolean;
}) {
  const viewer = useViewerTimezone();
  const tz = viewer ?? next?.timezone ?? "America/Sao_Paulo";
  const open = next?.opensAt ? Date.parse(next.opensAt) <= Date.parse(now) : false;

  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="sessions-hub">
      <Card className="flex flex-col" data-testid="sessions-hub-private">
        <CardContent className="flex flex-1 flex-col gap-4 pt-5">
          <div className="flex items-start gap-3">
            <IconPill tone="brand">
              <ScanFace aria-hidden="true" />
            </IconPill>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">Sessão particular</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Um registro seu, com os recursos que você escolher. Só você vê, e só fica o que você decidir.
              </p>
            </div>
          </div>
          <div className="mt-auto">
            <Button asChild variant="secondary">
              <a href="#particular">Começar sessão particular</a>
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="flex flex-col" data-testid="sessions-hub-professional">
        <CardContent className="flex flex-1 flex-col gap-4 pt-5">
          <div className="flex items-start gap-3">
            <IconPill tone="identity">
              <Video aria-hidden="true" />
            </IconPill>
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-ink">Sessão com profissional</h2>
              <p className="mt-1 text-sm text-ink-muted">
                Chamada com quem acompanha você. A chamada não é gravada: a Elyra só registra o que você ligar.
              </p>
            </div>
          </div>

          {!professionalAvailable ? (
            <p className="text-sm text-ink-muted">Não foi possível carregar sua agenda agora.</p>
          ) : next ? (
            <div className="flex items-start gap-3 rounded-control bg-surface-muted px-3.5 py-3" data-testid="sessions-hub-next">
              <CalendarClock className="mt-0.5 size-4 shrink-0 text-identity-700" aria-hidden="true" />
              <div className="min-w-0 text-sm">
                <p className="font-medium text-ink">
                  Próxima: {formatDayHeading(next.startsAt, tz)}, {formatTime(next.startsAt, tz)}
                </p>
                <p className="text-ink-muted">
                  {[next.professionalName, MODALITY_LABEL[next.modality]].filter(Boolean).join(" · ")}
                  {next.opensAt && !open ? ` · a entrada abre às ${formatTime(next.opensAt, tz)}` : ""}
                </p>
              </div>
            </div>
          ) : hasProfessional ? (
            <InlineEmpty>Nenhuma sessão marcada. Você pode pedir um horário.</InlineEmpty>
          ) : (
            <InlineEmpty>Você ainda não tem acompanhamento com um profissional.</InlineEmpty>
          )}

          <div className="mt-auto flex flex-wrap gap-2">
            {next?.sessionId && open ? (
              <Button asChild>
                <Link href={`/agenda/sessao/${next.sessionId}`}>Abrir sessão</Link>
              </Button>
            ) : null}
            {hasProfessional || !professionalAvailable ? (
              <Button asChild variant={next?.sessionId && open ? "secondary" : "primary"}>
                <Link href="/agenda">Ver sessão com profissional</Link>
              </Button>
            ) : (
              <Button asChild>
                <Link href="/profissionais">
                  <UserRoundSearch aria-hidden="true" />
                  Encontrar profissionais
                </Link>
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
