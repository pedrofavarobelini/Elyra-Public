import { Info } from "lucide-react";

import type { Comparison } from "@/lib/reports";
import { MIN_DAYS_FOR_COMPARISON } from "@/lib/reports";
import { cn } from "@/lib/utils";

/**
 * Quantos dias sustentam uma comparacao - e, quando nao sustentam, qual e o
 * minimo que faltou.
 *
 * **Por que isto existe.** O motor sempre soube: `Comparison` carrega
 * `currentSamples` e `previousSamples`, e devolve `insufficient_data` quando o
 * minimo nao e atingido. A tela e que nao contava. Quem lia via uma seta e um
 * numero, sem saber se aquilo vinha de dezoito dias ou de dois.
 *
 * O minimo vem de `MIN_DAYS_FOR_COMPARISON`, nunca escrito a mao. Havia duas
 * ocorrencias de "3" digitadas na tela de relatorios: mudar a constante teria
 * deixado o texto mentindo, e ninguem perceberia.
 *
 * **A frase mais importante e a de dado insuficiente.** Ela precisa dizer que
 * *nao da para afirmar*, e nao que *nao ha padrao*. As duas coisas sao
 * diferentes, e trocar uma pela outra transforma silencio de dado em conclusao
 * sobre a pessoa.
 */
export function describeSampleSize(comparison: Comparison): string {
  const { currentSamples, previousSamples, trend } = comparison;

  if (trend === "insufficient_data") {
    return (
      `Ainda não dá para afirmar uma tendência: são necessários ao menos ` +
      `${MIN_DAYS_FOR_COMPARISON} dias com registro em cada período. ` +
      `Este tem ${diasComRegistro(currentSamples)}; o anterior, ` +
      `${diasComRegistro(previousSamples)}.`
    );
  }

  return (
    `Comparação baseada em ${diasComRegistro(currentSamples)} neste período e ` +
    `${diasComRegistro(previousSamples)} no anterior.`
  );
}

function diasComRegistro(dias: number): string {
  return dias === 1 ? "1 dia" : `${dias} dias`;
}

/**
 * Nota de base amostral, para acompanhar qualquer comparacao exibida.
 *
 * Nunca esconde a comparacao por falta de dado: dizer que falta **e**
 * informacao, e some-la deixaria a pessoa sem saber por que a tela ficou vazia.
 */
export function SampleSizeNote({
  comparison,
  className,
}: {
  comparison: Comparison;
  className?: string;
}) {
  const insuficiente = comparison.trend === "insufficient_data";

  return (
    <p
      className={cn(
        "mt-1 flex items-start gap-1.5 text-xs",
        insuficiente ? "text-ink-subtle" : "text-ink-muted",
        className,
      )}
    >
      {insuficiente ? (
        <Info className="mt-px size-3 shrink-0" aria-hidden="true" />
      ) : null}
      <span>{describeSampleSize(comparison)}</span>
    </p>
  );
}
