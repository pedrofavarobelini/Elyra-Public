import type { PrimaryGoal } from "@/lib/contracts/identity";
import { ROTINA, type RotinaId } from "@/lib/routines";



export interface PassoDoPlano {
  /** Rotulo curto do destino. */
  label: string;
  /** Uma linha sobre o que ha la. Descreve, nao promete. */
  descricao: string;
  /** Rota interna. Nunca URL externa. */
  href: string;
}

export interface PlanoPessoal {
  /** Frase de abertura — descreve o caminho, sem prometer efeito. */
  chamada: string;
  passos: PassoDoPlano[];
  /** Rotina que combina com o objetivo, quando houver uma obvia. */
  rotina: RotinaId | null;
}

const PASSO = {
  checkin: {
    label: "Meu Humor",
    descricao: "Registrar como você está, quando quiser.",
    href: "/meu-humor",
  },
  sono: {
    label: "Sono",
    descricao: "Anotar como foi a noite, em Meu Humor.",
    href: "/meu-humor",
  },
  diario: {
    label: "Diário",
    descricao: "Escrever o que não cabe numa escala.",
    href: "/diario",
  },
  metas: {
    label: "Metas",
    descricao: "Acompanhar o que você decidiu praticar.",
    href: "/metas",
  },
  relatorios: {
    label: "Relatórios",
    descricao: "Ver seus registros reunidos por período.",
    href: "/relatorios",
  },
  jornada: {
    label: "Histórico",
    descricao: "Sua semana, seu mês e a linha do tempo.",
    href: "/historico",
  },
  ciclo: {
    label: "Ciclo",
    descricao: "Registrar o que você observar, se o módulo estiver ligado.",
    href: "/ciclo",
  },
} as const satisfies Record<string, PassoDoPlano>;

/**
 * O caminho de cada objetivo.
 *
 * A tabela e explicita, e nao gerada por regra: sao oito objetivos fechados, e um
 * mapa que alguem consegue ler inteiro e melhor do que uma heuristica que ninguem
 * consegue prever.
 */
const PLANOS: Record<PrimaryGoal, PlanoPessoal> = {
  sleep: {
    chamada: "Estes são os espaços da Elyra que falam de sono.",
    passos: [PASSO.sono, PASSO.checkin, PASSO.jornada],
    rotina: ROTINA.DORMIR,
  },
  mood_understanding: {
    chamada: "Um caminho para acompanhar o próprio humor ao longo do tempo.",
    passos: [PASSO.checkin, PASSO.diario, PASSO.relatorios],
    rotina: ROTINA.REFLEXAO,
  },
  healthy_habits: {
    chamada: "Onde os hábitos ficam registrados e acompanhados.",
    passos: [PASSO.metas, PASSO.checkin, PASSO.jornada],
    rotina: ROTINA.FOCO,
  },
  routine: {
    chamada: "Onde a rotina do dia aparece organizada.",
    passos: [PASSO.metas, PASSO.jornada, PASSO.checkin],
    rotina: ROTINA.PAUSA,
  },
  self_knowledge: {
    chamada: "Um caminho para olhar a própria história com calma.",
    passos: [PASSO.diario, PASSO.checkin, PASSO.jornada],
    rotina: ROTINA.REFLEXAO,
  },
  wellbeing: {
    chamada: "Alguns espaços para acompanhar como você tem estado.",
    passos: [PASSO.checkin, PASSO.sono, PASSO.jornada],
    rotina: ROTINA.DESACELERAR,
  },
  cycle_tracking: {
    chamada: "Onde o ciclo é registrado — só o que você observar.",
    passos: [PASSO.ciclo, PASSO.checkin, PASSO.relatorios],
    rotina: null,
  },
  other: {

    chamada: "Um caminho geral pela Elyra, para você começar por onde preferir.",
    passos: [PASSO.checkin, PASSO.diario, PASSO.jornada],
    rotina: ROTINA.PAUSA,
  },
};

/** Caminho de quem ainda nao escolheu objetivo. */
const PLANO_PADRAO: PlanoPessoal = {
  chamada: "Você pode começar por qualquer um destes espaços.",
  passos: [PASSO.checkin, PASSO.diario, PASSO.jornada],
  rotina: ROTINA.PAUSA,
};


export function planoPara(objetivo: PrimaryGoal | null): PlanoPessoal {
  return objetivo ? PLANOS[objetivo] : PLANO_PADRAO;
}
