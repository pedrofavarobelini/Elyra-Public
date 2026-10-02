import type * as React from "react";

import { SampleSizeNote } from "@/components/charts/sample-size";
import { IconPill } from "@/components/ui/icon-pill";
import type { Comparison } from "@/lib/reports";
import { formatScore } from "@/lib/utils";

/**
 * Uma metrica comparada com o **proprio** periodo anterior da pessoa.
 *
 * Estava dentro da tela de relatorios. Saiu para ca quando o dashboard passou a
 * responder "como foi minha semana?" - duas telas mostrando a mesma comparacao
 * precisam mostra-la do mesmo jeito, ou a mesma variacao passa a ter duas
 * leituras dependendo de onde a pessoa olha.
 *
 * Tres regras que o componente carrega, e nao quem o usa:
 *
 * 1. `current === null` renderiza ausencia, **nunca** `0`;
 * 2. subir nem sempre e melhorar - `higherIsBetter` existe porque ansiedade
 *    subindo nao e progresso;
 * 3. a base amostral vem junto, sempre. Uma seta sem quantos dias a sustentam
 *    afirma mais do que o dado permite.
 *
 * A comparacao e sempre contra o proprio historico. Nunca contra norma
 * populacional - o produto nao tem, nem deve ter, uma media de "pessoa normal".
 *
 * **`windowDays` existe para desambiguar nome acessivel.** O dashboard mostra
 * "Ansiedade percebida" duas vezes: o valor de hoje, em `StatCard`, e a variacao
 * da semana, aqui. Com o mesmo `aria-label` nos dois, quem usa leitor de tela
 * ouvia o mesmo nome para coisas diferentes, sem distinguir o registro de hoje
 * da tendencia do periodo - e a regiao ao redor nao resolve, porque o nome de um
 * grupo precisa se sustentar sozinho.
 *
 * Em `/relatorios` os rotulos ja sao proprios ("Humor medio"), nao ha colisao, e
 * o parametro fica de fora: acrescentar sufixo onde nao ha ambiguidade tornaria
 * o nome mais longo sem tornar nada mais claro.
 */
export function ComparisonCard({
  label,
  comparison,
  format,
  formatDelta,
  unit,
  tone,
  icon,
  windowDays,
  layout = "card",
  showSampleNote = true,
}: {
  label: string;
  comparison: Comparison;
  format: (value: number) => string;
  formatDelta?: (value: number) => string;
  unit?: string;
  tone: "brand" | "anxiety" | "sleep" | "energy";
  icon: React.ReactNode;
  /**
   * Direcao desejavel da metrica. Desde o F7 nao pinta a variacao (tinta
   * neutra); fica no contrato para leitura e para leitores futuros.
   */
  higherIsBetter: boolean;
  /**
   * Tamanho da janela comparada, em dias. Quando informado, entra no nome
   * acessivel - use somente onde o rotulo sozinho colidiria com outro grupo.
   */
  windowDays?: number;
  /**
   * `card` isolado (relatorios) ou `row`, linha larga dentro de um painel de
   * resumo (dashboard). A regra e a mesma; so a geometria muda — em linha, a
   * nota de base amostral ocupa largura em vez de empilhar texto numa coluna
   * estreita.
   */
  layout?: "card" | "row";
  /**
   * So um agrupador pode desligar: quando varias comparacoes lado a lado tem a
   * **mesma** frase de base amostral, ele a mostra uma vez para o grupo, com o
   * mesmo texto. A informacao continua na tela; some apenas a repeticao.
   */
  showSampleNote?: boolean;
}) {
  const { current, delta } = comparison;

  return (
    <div
      role="group"
      aria-label={
        windowDays === undefined
          ? label
          : `${label}, comparação de ${windowDays} dias`
      }
      className={
        layout === "row"
          ? "flex items-start gap-3 rounded-control bg-surface-muted/60 p-3.5 sm:gap-4"
          : "flex items-start gap-3 rounded-card border border-line bg-surface p-4 shadow-card sm:gap-4"
      }
    >
      <IconPill tone={tone}>{icon}</IconPill>
      <div className="min-w-0 flex-1">
        <p className="text-sm text-ink-muted">{label}</p>

        {current === null ? (
          <p className="mt-1 text-sm text-ink-subtle">Sem registro</p>
        ) : (
          <p className="mt-0.5 flex items-baseline gap-1">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-ink">
              {format(current)}
            </span>
            {unit ? <span className="text-sm text-ink-muted">{unit}</span> : null}
          </p>
        )}

        {delta === null ? (
          <p className="mt-1 text-xs text-ink-subtle">
            Sem base de comparação no período anterior
          </p>
        ) : (
          <p
            // F7: variacao em tinta neutra. Subir nao e "bom" nem descer e
            // "ruim" por cor — seta e texto dizem a direcao; a Elyra nao julga.
            className="mt-1 text-xs text-ink-muted"
          >
            {delta === 0
              ? "Estável"
              : `${delta > 0 ? "↑" : "↓"} ${deltaText(delta, { format, formatDelta, unit })}`}{" "}
            vs. período anterior
          </p>
        )}

        {showSampleNote ? <SampleSizeNote comparison={comparison} /> : null}
      </div>
    </div>
  );
}

/**
 * Variacao **sempre com unidade** (F7, L-314). O defeito real: `/pro/relatorios`
 * mostrava "Sono ↓ 5,6" — minutos formatados como score, sem unidade. Agora,
 * sem `formatDelta`, a variacao usa o proprio `format` da metrica (sono vira
 * "0h 06m"), e score 0–10 diz "ponto(s)".
 */
export function deltaText(
  delta: number,
  { format, formatDelta, unit }: { format: (value: number) => string; formatDelta?: (value: number) => string; unit?: string },
): string {
  if (formatDelta) return formatDelta(delta);
  const magnitude = Math.abs(delta);
  if (unit === "/10") {
    const score = formatScore(magnitude) ?? "—";
    return `${score} ${score === "1,0" || score === "1" ? "ponto" : "pontos"}`;
  }
  return `${format(magnitude)}${unit ? ` ${unit}` : ""}`;
}
