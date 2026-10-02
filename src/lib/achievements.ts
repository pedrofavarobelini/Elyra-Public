import type { EventoJornada } from "@/lib/journey";
import { EVENTO, derivarDiasAcompanhados } from "@/lib/journey";



export const CONQUISTA = {
  PRIMEIRO_CHECKIN: "primeiro_checkin",
  PRIMEIRA_ANOTACAO: "primeira_anotacao",
  PRIMEIRA_META: "primeira_meta",
  DEZ_REGISTROS: "dez_registros",
  SETE_DIAS: "sete_dias",
  UM_MES: "um_mes",
} as const;

export type TipoConquista = (typeof CONQUISTA)[keyof typeof CONQUISTA];

export interface Conquista {
  id: TipoConquista;
  titulo: string;
  /** O fato que a sustenta — verificavel na propria linha do tempo. */
  detalhe: string;
}

/** Ordem de exibicao: a mesma sempre, do primeiro marco ao mais distante. */
const ORDEM: TipoConquista[] = [
  CONQUISTA.PRIMEIRO_CHECKIN,
  CONQUISTA.PRIMEIRA_ANOTACAO,
  CONQUISTA.PRIMEIRA_META,
  CONQUISTA.DEZ_REGISTROS,
  CONQUISTA.SETE_DIAS,
  CONQUISTA.UM_MES,
];

const TITULO: Record<TipoConquista, string> = {
  [CONQUISTA.PRIMEIRO_CHECKIN]: "Primeiro check-in",
  [CONQUISTA.PRIMEIRA_ANOTACAO]: "Primeira anotação",
  [CONQUISTA.PRIMEIRA_META]: "Primeiro progresso em meta",
  [CONQUISTA.DEZ_REGISTROS]: "10 registros",
  [CONQUISTA.SETE_DIAS]: "7 dias acompanhados",
  [CONQUISTA.UM_MES]: "Um mês de registros",
};

/**
 * As conquistas alcancadas, derivadas da sequencia.
 *
 * **So as alcancadas.** Nao existe lista de conquistas "bloqueadas": mostrar o
 * que falta transformaria a tela num painel de pendencias, que e exatamente o
 * oposto do 8.12.
 */
export function derivarConquistas(
  eventos: readonly EventoJornada[],
): Conquista[] {
  if (eventos.length === 0) return [];

  const dias = derivarDiasAcompanhados(eventos);
  const totalDias = dias.size;
  const alcancadas = new Set<TipoConquista>();

  if (eventos.some((e) => e.tipo === EVENTO.CHECKIN)) {
    alcancadas.add(CONQUISTA.PRIMEIRO_CHECKIN);
  }
  if (eventos.some((e) => e.tipo === EVENTO.DIARIO)) {
    alcancadas.add(CONQUISTA.PRIMEIRA_ANOTACAO);
  }
  if (eventos.some((e) => e.tipo === EVENTO.META)) {
    alcancadas.add(CONQUISTA.PRIMEIRA_META);
  }
  if (eventos.length >= 10) alcancadas.add(CONQUISTA.DEZ_REGISTROS);
  if (totalDias >= 7) alcancadas.add(CONQUISTA.SETE_DIAS);

  /*
    "Um mes" e distancia entre o primeiro e o ultimo registro, e nao 30 dias
    **seguidos**. Quem registrou no dia 1 e no dia 31 acompanhou por um mes,
    mesmo tendo descansado no meio — e cobrar os dias do meio seria streak com
    outro nome.
  */
  const ordenados = [...dias.keys()].sort();
  const primeiro = ordenados[0];
  const ultimo = ordenados[ordenados.length - 1];
  if (primeiro && ultimo) {
    const distancia =
      (new Date(`${ultimo}T12:00:00`).getTime() -
        new Date(`${primeiro}T12:00:00`).getTime()) /
      86_400_000;
    if (distancia >= 29) alcancadas.add(CONQUISTA.UM_MES);
  }

  const detalhe: Record<TipoConquista, string> = {
    [CONQUISTA.PRIMEIRO_CHECKIN]: "Você registrou como estava pela primeira vez.",
    [CONQUISTA.PRIMEIRA_ANOTACAO]: "Você escreveu no Diário pela primeira vez.",
    [CONQUISTA.PRIMEIRA_META]: "Você registrou progresso em uma meta.",
    [CONQUISTA.DEZ_REGISTROS]: `Você já tem ${eventos.length} registros na Elyra.`,
    [CONQUISTA.SETE_DIAS]: `Você acompanhou ${totalDias} dias até aqui.`,
    [CONQUISTA.UM_MES]: "Seus registros cobrem mais de um mês.",
  };

  return ORDEM.filter((id) => alcancadas.has(id)).map((id) => ({
    id,
    titulo: TITULO[id],
    detalhe: detalhe[id],
  }));
}

/**
 * Consistencia da semana — dias acompanhados, **nunca** dias seguidos.
 *
 * Devolve a frase pronta porque a frase **e** a regra: qualquer variacao que
 * fale em sequencia, meta de dias ou dia perdido estaria fora do escopo 8.12.
 */
export function consistenciaDaSemana(diasComRegistro: number): string {
  if (diasComRegistro <= 0) {
    // Ausencia descrita, sem cobranca e sem "voce nao acompanhou".
    return "Ainda não há dias com registro nesta semana.";
  }
  if (diasComRegistro === 1) return "1 dia de acompanhamento nesta semana.";
  return `${diasComRegistro} dias de acompanhamento nesta semana.`;
}

/** Termos que nenhuma copy de engajamento pode conter — verificado por teste. */
export const ENGAJAMENTO_TERMOS_PROIBIDOS = [
  "sequência",
  "sequencia",
  "streak",
  "seguidos",
  "em dia",
  "você perdeu",
  "voce perdeu",
  "não perca",
  "nao perca",
  "recorde",
  "ranking",
  "nível",
  "nivel",
  "pontos",
  "parabéns",
  "parabens",
  "continue assim",
  "meta de dias",
] as const;
