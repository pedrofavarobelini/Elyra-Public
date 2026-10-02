"use client";

import { Card } from "@/components/ui/card";
import {
  FAIXA_LABEL,
  derivarDiasAcompanhados,
  diasDoMes,
  faixaDoDia,
  type EventoJornada,
  type FaixaDeDia,
} from "@/lib/journey";
import { cn } from "@/lib/utils";



const FAIXA_CLASSE: Record<FaixaDeDia, string> = {
  // Ausencia = superficie neutra. Nenhum tom de alerta para "nao registrou".
  "sem-registro": "bg-surface-muted text-ink-subtle",
  leve: "bg-brand-100 text-brand-700",
  media: "bg-brand-300 text-brand-900",
  // Branco sobre brand-600 = 5,77:1 nos dois temas (text-surface ficava escuro no escuro).
  intensa: "bg-brand-600 text-white",
};

const DIAS_DA_SEMANA = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"] as const;

/** Posicao do dia na semana, com a semana comecando na segunda. */
function colunaDoDia(dia: string): number {
  const [ano, mes, d] = dia.split("-").map(Number);
  const data = new Date(ano!, mes! - 1, d!);
  return (data.getDay() + 6) % 7;
}

export function MonthHeatmap({
  eventos,
  mes,
  className,
}: {
  eventos: readonly EventoJornada[];
  /** Mes civil (YYYY-MM). */
  mes: string;
  className?: string;
}) {
  const dias = diasDoMes(mes);
  if (dias.length === 0) return null;

  const acompanhados = derivarDiasAcompanhados(eventos);
  const comRegistro = dias.filter((d) => (acompanhados.get(d)?.total ?? 0) > 0).length;
  const vazioAntes = colunaDoDia(dias[0]!);

  const rotuloMes = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${mes}-01T12:00:00`));

  return (
    <Card className={cn("p-4 sm:p-5", className)}>
      <h2 id="dias-acompanhados" className="text-base font-semibold text-ink lg:text-lg">
        Dias acompanhados
      </h2>
      <p className="mt-1 text-sm capitalize text-ink-muted">{rotuloMes}</p>

      <table className="mt-3 w-full table-fixed border-separate border-spacing-1">
        <caption className="sr-only">
          Dias do mês com registro. Cada célula informa o dia e quantos registros
          houve.
        </caption>
        <thead>
          <tr>
            {DIAS_DA_SEMANA.map((d) => (
              <th
                key={d}
                scope="col"
                className="pb-1 text-center text-xs font-medium text-ink-muted"
              >
                {d}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas(dias, vazioAntes).map((linha, i) => (
            <tr key={i}>
              {linha.map((dia, j) =>
                dia === null ? (
                  <td key={`v-${j}`} aria-hidden="true" />
                ) : (
                  <td key={dia} className="p-0">
                    <Celula dia={dia} total={acompanhados.get(dia)?.total ?? 0} />
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>

      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {(Object.keys(FAIXA_LABEL) as FaixaDeDia[]).map((faixa) => (
          <li key={faixa} className="flex items-center gap-1.5 text-xs text-ink-muted">
            <span
              aria-hidden="true"
              className={cn("size-3 rounded-sm border border-line", FAIXA_CLASSE[faixa])}
            />
            {FAIXA_LABEL[faixa]}
          </li>
        ))}
      </ul>

      <p className="mt-3 text-sm text-ink-muted">
        {comRegistro === 0
          ? "Ainda não há registros neste mês."
          : comRegistro === 1
            ? "1 dia com registro neste mês."
            : `${comRegistro} dias com registro neste mês.`}
      </p>
    </Card>
  );
}

function Celula({ dia, total }: { dia: string; total: number }) {
  const faixa = faixaDoDia(total);
  const numero = Number(dia.slice(-2));
  return (
    <span
      // O rotulo textual e o que o leitor de tela anuncia: a cor e so reforco.
      aria-label={`Dia ${numero}: ${total === 0 ? "sem registro" : total === 1 ? "1 registro" : `${total} registros`}`}
      title={`Dia ${numero}: ${FAIXA_LABEL[faixa]}`}
      className={cn(
        "flex aspect-square w-full items-center justify-center rounded-sm border border-line text-xs font-medium",
        FAIXA_CLASSE[faixa],
      )}
    >
      {numero}
    </span>
  );
}

/** Quebra os dias em semanas, preenchendo o inicio do mes. */
function linhas(dias: string[], vazioAntes: number): (string | null)[][] {
  const celulas: (string | null)[] = [...Array<null>(vazioAntes).fill(null), ...dias];
  const semanas: (string | null)[][] = [];
  for (let i = 0; i < celulas.length; i += 7) {
    const semana = celulas.slice(i, i + 7);
    while (semana.length < 7) semana.push(null);
    semanas.push(semana);
  }
  return semanas;
}
