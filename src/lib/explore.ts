import type { AssociationMetric, DayGroupInput } from "@/lib/associations";



export const METRICAS_EXPLORAVEIS = [
  "mood",
  "anxiety",
  "energy",
  "sleepHours",
] as const satisfies readonly AssociationMetric[];

export const METRICA_LABEL: Record<AssociationMetric, string> = {
  mood: "humor",
  // O nome completo importa: o sistema nao mede ansiedade, a pessoa relata.
  anxiety: "ansiedade percebida",
  energy: "energia",
  sleepHours: "horas de sono",
};

/** Rotulo para o seletor, comecando em maiuscula. */
export function metricaTitulo(metrica: AssociationMetric): string {
  const label = METRICA_LABEL[metrica];
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * A pergunta do cruzamento, sob a metrica escolhida.
 *
 * Forma fixa e de coocorrencia: "X aparece junto com uma Y diferente?". Nao ha
 * caminho aqui que produza verbo de efeito — a frase e montada por template, e
 * nao concatenada com texto vindo de outro lugar.
 *
 * `withLabel` vem do produto (e nao da pessoa) em tres dos quatro cruzamentos;
 * no de fator, ele carrega o rotulo do fator, que **pode** ser criado pela
 * pessoa. Por isso ele so aparece entre aspas, dentro de uma frase que ja esta
 * fechada — nunca como comeco de oracao.
 */
export function perguntaExploravel(
  withLabel: string,
  metrica: AssociationMetric,
): string {
  return `Nos dias em que ${withLabel.toLowerCase()}, ${METRICA_LABEL[metrica]} aparece diferente?`;
}

/** O mesmo agrupamento de dias, olhado por outra metrica. */
export function reexpressar(
  entrada: DayGroupInput,
  metrica: AssociationMetric,
): DayGroupInput {
  return {
    ...entrada,
    // O id carrega a metrica: dois cruzamentos do mesmo grupo sob metricas
    // diferentes sao perguntas diferentes, e nao podem colidir em `key`.
    id: `${entrada.id}:${metrica}`,
    metric: metrica,
    question: perguntaExploravel(entrada.withLabel, metrica),
  };
}


export function explorar(
  entradas: readonly DayGroupInput[],
  metrica: AssociationMetric | null,
): DayGroupInput[] {
  if (metrica === null) return [...entradas];
  return entradas.map((entrada) => reexpressar(entrada, metrica));
}
