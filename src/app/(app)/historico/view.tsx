"use client";

import { useMemo } from "react";

import { EmptyState } from "@/components/states";
import { EditCheckinDialog } from "./edit-checkin-dialog";
import { PageHeader } from "@/components/journey/page-header";
import { HISTORY_DOMAINS, OlderHistoryNotice } from "@/components/journey/older-history";
import { MonthHeatmap } from "@/components/journey/month-heatmap";
import { Timeline } from "@/components/journey/timeline";
import { WeekSummary } from "@/components/journey/week-summary";
import { Achievements } from "@/components/journey/achievements";
import { derivarLinhaDoTempo } from "@/lib/journey";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { PRIMARY_FEELING_LABEL } from "@/lib/contracts/emotional";
import { formatDuration, formatScore } from "@/lib/utils";
import { useMockStore } from "@/mocks/store";

function ScoreCell({ value, unit = "/10" }: { value: number | null; unit?: string }) {
  const formatted = formatScore(value);
  return formatted === null ? (
    <span className="text-ink-subtle">Sem registro</span>
  ) : (
    <span className="font-medium text-ink">
      {formatted}
      <span className="text-ink-muted">{unit}</span>
    </span>
  );
}

export function HistoryView() {
  const { checkins, sleep, journal, goals, goalProgress, factors, cycle, cycleRecords } =
    useMockStore();


  const linhaDoTempo = useMemo(
    () =>
      derivarLinhaDoTempo({
        checkins,
        sleep,
        journal,
        goals,
        goalProgress,
        cycleRecords,
        cicloAtivo: cycle.enabled,
      }),
    [checkins, sleep, journal, goals, goalProgress, cycleRecords, cycle.enabled],
  );

  const mesAtual = new Date().toISOString().slice(0, 7);


  const estadoDaSemana = useMemo(
    () => ({
      checkins,
      sleep,
      journal,
      goals,
      goalProgress,
      factors,
      cycleRecords,
      cicloAtivo: cycle.enabled,
    }),
    [checkins, sleep, journal, goals, goalProgress, factors, cycleRecords, cycle.enabled],
  );

  const ordered = [...checkins].sort(
    (a, b) =>
      new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );

  const sleepOrdered = [...sleep].sort((a, b) => b.night.localeCompare(a.night));

  return (
    <>
      <PageHeader
        title="Histórico"
        description="Todos os seus registros, do mais recente para o mais antigo."
      />

      <OlderHistoryNotice domains={HISTORY_DOMAINS.journey} />

      {/*
        Era 8, G2. A jornada vem primeiro — "o que aconteceu, em ordem" — e as
        tabelas por dominio continuam abaixo, para quem quer conferir valor a
        valor. Nenhuma tela nova: a navegacao segue com os mesmos 7 itens.
      */}
      <section aria-labelledby="minha-semana" className="mb-6">
        <WeekSummary estado={estadoDaSemana} />
      </section>

      <section aria-labelledby="dias-acompanhados" className="mb-6">
        <MonthHeatmap eventos={linhaDoTempo} mes={mesAtual} />
      </section>

      {/* Sem registro o bloco some (Achievements devolve null); a secao nao pode
          ficar rotulada por um titulo que nao existe (axe aria-prohibited-attr). */}
      {linhaDoTempo.length > 0 ? (
        <section aria-labelledby="conquistas" className="mb-6">
          <Achievements eventos={linhaDoTempo} />
        </section>
      ) : null}

      <section aria-labelledby="linha-do-tempo" className="mb-8">
        <Timeline eventos={linhaDoTempo} />
      </section>

      <section aria-labelledby="h-checkins" className="mb-8">
        <h2 id="h-checkins" className="mb-3 text-lg font-semibold text-ink">
          Check-ins emocionais
        </h2>

        {ordered.length === 0 ? (
          <Card>
            <EmptyState
              title="Nenhum check-in registrado"
              description="Seus registros aparecerão aqui."
            />
          </Card>
        ) : (
          /* `tabIndex` + `role=region`: sem isso, quem navega por teclado nao
             consegue rolar a tabela horizontalmente no mobile
             (axe: scrollable-region-focusable).

             `relative` nao e estetica: sem posicionamento, este Card nao e o
             bloco contentor dos descendentes absolutos, e `overflow-x` so corta
             quem tem o contentor dentro dele. Os `sr-only` da tabela sao
             `position: absolute` - a coluna de correcao empurrou o dela para
             x=541, fora do viewport de 393, e o **documento** passou a rolar na
             horizontal enquanto a tabela rolava certinho por dentro. Medido:
             `documentElement.scrollWidth` 542 contra `body.scrollWidth` 393. */
          <Card
            className="relative overflow-x-auto"
            role="region"
            aria-label="Tabela de check-ins emocionais"
            tabIndex={0}
          >
            <table className="w-full min-w-[640px] text-sm">
              <caption className="sr-only">
                Check-ins emocionais registrados
              </caption>
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th scope="col" className="p-4 font-medium">Quando</th>
                  <th scope="col" className="p-4 font-medium">Sentimento</th>
                  <th scope="col" className="p-4 font-medium">Humor</th>
                  <th scope="col" className="p-4 font-medium">Ansiedade percebida</th>
                  <th scope="col" className="p-4 font-medium">Energia</th>
                  <th scope="col" className="p-4 font-medium">
                    <span className="sr-only">Corrigir</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {ordered.map((c) => {
                  const when = new Date(c.occurredAt);
                  return (
                    <tr key={c.id} className="border-b border-line last:border-0">
                      <td className="p-4 text-ink-muted">
                        {when.toLocaleDateString("pt-BR")}{" "}
                        <span className="text-ink-subtle">
                          {when.toLocaleTimeString("pt-BR", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="p-4">
                        {c.primaryFeeling ? (
                          <Badge tone="brand">
                            {PRIMARY_FEELING_LABEL[c.primaryFeeling]}
                          </Badge>
                        ) : (
                          <span className="text-ink-subtle">Sem registro</span>
                        )}
                      </td>
                      <td className="p-4"><ScoreCell value={c.mood} /></td>
                      <td className="p-4"><ScoreCell value={c.perceivedAnxiety} /></td>
                      <td className="p-4"><ScoreCell value={c.energy} /></td>
                      <td className="p-4 text-right">
                        <EditCheckinDialog checkin={c} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>

      <section aria-labelledby="h-sleep">
        <h2 id="h-sleep" className="mb-3 text-lg font-semibold text-ink">
          Sono
        </h2>

        {sleepOrdered.length === 0 ? (
          <Card>
            <EmptyState title="Nenhum registro de sono" />
          </Card>
        ) : (
          <Card>
            <CardContent className="flex flex-col divide-y divide-line p-0">
              {sleepOrdered.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-wrap items-center justify-between gap-3 p-4"
                >
                  <span className="text-ink-muted">
                    {new Date(`${s.night}T00:00:00`).toLocaleDateString("pt-BR")}
                  </span>
                  <span className="flex items-center gap-6">
                    <span>
                      <span className="text-ink-muted">Duração: </span>
                      {formatDuration(s.durationMinutes) ?? (
                        <span className="text-ink-subtle">Sem registro</span>
                      )}
                    </span>
                    <span>
                      <span className="text-ink-muted">Qualidade: </span>
                      <ScoreCell value={s.quality} />
                    </span>
                  </span>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </section>
    </>
  );
}
