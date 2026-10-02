import {
  MIN_DAYS_FOR_ASSOCIATION,
  mean,
  roundMetric,
  type DailyAnalyticsPoint,
} from "@/lib/reports";


export type AssociationMetric = "mood" | "anxiety" | "energy" | "sleepHours";

export interface AssociationGroup {
  /** Como o grupo e nomeado na tela, ja em linguagem de coocorrencia. */
  label: string;
  mean: number | null;
  samples: number;
}

export interface DayGroupAssociation {
  id: string;
  status: "available" | "insufficient_data";
  metric: AssociationMetric;
  /** Pergunta que este cruzamento responde, na primeira pessoa. */
  question: string;
  withGroup: AssociationGroup;
  withoutGroup: AssociationGroup;
  /** `withGroup.mean - withoutGroup.mean`, so quando os dois sustentam. */
  delta: number | null;
}

function valueOf(
  point: DailyAnalyticsPoint,
  metric: AssociationMetric,
): number | null {
  switch (metric) {
    case "mood":
      return point.mood;
    case "anxiety":
      return point.anxiety;
    case "energy":
      return point.energy;
    case "sleepHours":
      return point.sleepHours;
  }
}

/** Descarta ausencia. Ausencia nunca entra na media como zero. */
function present(values: Array<number | null>): number[] {
  return values.filter((value): value is number => value !== null);
}

export interface DayGroupInput {
  id: string;
  question: string;
  metric: AssociationMetric;
  withLabel: string;
  withoutLabel: string;
  /** Dias civis (`YYYY-MM-DD`) que pertencem ao grupo "com". */
  days: ReadonlySet<string>;
}

/**
 * Divide a janela em dois grupos de dias e compara a metrica entre eles.
 *
 * O dia entra num grupo ou no outro - nunca nos dois, nunca em nenhum. Dias sem
 * a metrica registrada saem da media dos dois lados, e nao viram zero.
 */
export function buildDayGroupAssociation(
  points: DailyAnalyticsPoint[],
  input: DayGroupInput,
): DayGroupAssociation {
  const dentro = present(
    points
      .filter((point) => input.days.has(point.date))
      .map((point) => valueOf(point, input.metric)),
  );
  const fora = present(
    points
      .filter((point) => !input.days.has(point.date))
      .map((point) => valueOf(point, input.metric)),
  );

  const mediaDentro = mean(dentro);
  const mediaFora = mean(fora);
  const sustenta =
    dentro.length >= MIN_DAYS_FOR_ASSOCIATION &&
    fora.length >= MIN_DAYS_FOR_ASSOCIATION;

  return {
    id: input.id,
    status: sustenta ? "available" : "insufficient_data",
    metric: input.metric,
    question: input.question,
    withGroup: {
      label: input.withLabel,
      mean: roundMetric(mediaDentro),
      samples: dentro.length,
    },
    withoutGroup: {
      label: input.withoutLabel,
      mean: roundMetric(mediaFora),
      samples: fora.length,
    },
    delta:
      sustenta && mediaDentro !== null && mediaFora !== null
        ? roundMetric(mediaDentro - mediaFora)
        : null,
  };
}

/**
 * Frase de um cruzamento - **coocorrencia, nunca causa**.
 *
 * A regra que a V1 ja aplicava ao ciclo ("associacao temporal descreve
 * coincidencia no tempo e nao indica causa") vale para todos os cruzamentos, e
 * e por isso que esta funcao existe em vez de cada tela escrever a propria
 * frase: e onde a restricao fica impossivel de esquecer.
 *
 * Verbos proibidos por construcao: "causa", "provoca", "melhora", "piora",
 * "faz com que". O texto descreve **quando as duas coisas aparecem juntas**.
 */
export function describeAssociation(association: DayGroupAssociation): string {
  if (association.status === "insufficient_data") {
    return (
      `Ainda não dá para descrever essa coincidência: são necessários ao menos ` +
      `${MIN_DAYS_FOR_ASSOCIATION} dias com registro em cada grupo. ` +
      `${association.withGroup.label}: ${association.withGroup.samples}. ` +
      `${association.withoutGroup.label}: ${association.withoutGroup.samples}. ` +
      `Isso não significa que não exista relação - significa que os dados ainda não permitem descrevê-la.`
    );
  }

  if (association.delta === 0) {
    return (
      `Nos dias em que ${association.withGroup.label.toLowerCase()}, a média ficou ` +
      `próxima da dos demais dias. As duas coisas não apareceram associadas nesta janela.`
    );
  }

  const direcao = (association.delta ?? 0) > 0 ? "mais alta" : "mais baixa";
  return (
    `Nos dias em que ${association.withGroup.label.toLowerCase()}, a média foi ` +
    `${direcao} do que nos demais dias desta janela. É uma coincidência no tempo, ` +
    `não uma causa: descrever quando duas coisas aparecem juntas não explica por quê.`
  );
}
