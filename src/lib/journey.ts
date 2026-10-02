import type { CycleDailyRecord } from "@/lib/contracts/cycle";
import type { EmotionalCheckin } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import type { SleepRecord } from "@/lib/contracts/emotional";
import { diaCivil } from "@/lib/today";



export const EVENTO = {
  CHECKIN: "checkin",
  SONO: "sono",
  DIARIO: "diario",
  META: "meta",
  CICLO: "ciclo",
} as const;

export type TipoEvento = (typeof EVENTO)[keyof typeof EVENTO];

export interface EventoJornada {
  id: string;
  tipo: TipoEvento;
  /** Dia civil local (YYYY-MM-DD) — a chave de agrupamento do heatmap. */
  dia: string;
  /** Instante usado so para ordenar dentro do dia. */
  ordem: string;
  titulo: string;
  detalhe?: string;
  /** Rota interna do dominio de origem. */
  href: string;
}

export interface EstadoDaJornada {
  checkins: readonly EmotionalCheckin[];
  sleep: readonly SleepRecord[];
  journal: readonly JournalEntry[];
  goals: readonly Goal[];
  goalProgress: readonly GoalProgressEntry[];
  cycleRecords: readonly CycleDailyRecord[];
  /** Ciclo desligado nao entra na jornada, mesmo com registros guardados. */
  cicloAtivo: boolean;
}

const FEELING_LABEL: Record<string, string> = {
  feliz: "Feliz",
  tranquilo: "Tranquilo",
  neutro: "Neutro",
  triste: "Triste",
  ansioso: "Ansioso",
};

/** "18/09" a partir de um dia civil. */
export function diaCurto(dia: string): string {
  const [, mes, d] = dia.split("-");
  return `${d}/${mes}`;
}

function deCheckins(lista: readonly EmotionalCheckin[]): EventoJornada[] {
  return lista.map((c) => {
    const sentimento = c.primaryFeeling ? FEELING_LABEL[c.primaryFeeling] : null;
    /*
      Ausencia nao vira zero: um check-in sem sentimento declarado e "Check-in
      registrado", e nao "Sentimento: nenhum".
    */
    return {
      id: `checkin:${c.id}`,
      tipo: EVENTO.CHECKIN,
      dia: diaCivil(new Date(c.occurredAt)),
      ordem: c.occurredAt,
      titulo: sentimento ? `Check-in — ${sentimento}` : "Check-in registrado",
      href: "/meu-humor",
    };
  });
}

function deSono(lista: readonly SleepRecord[]): EventoJornada[] {
  return lista.map((s) => {
    const horas =
      s.durationMinutes === null
        ? null
        : `${Math.floor(s.durationMinutes / 60)}h${String(s.durationMinutes % 60).padStart(2, "0")}`;
    return {
      id: `sono:${s.night}`,
      tipo: EVENTO.SONO,
      dia: s.night,
      // Sono e registro de noite, sem hora: ancora no fim do dia para nao
      // aparecer antes dos eventos que realmente aconteceram de manha.
      ordem: `${s.night}T23:59:59`,
      titulo: horas ? `Sono — ${horas}` : "Sono registrado",
      href: "/meu-humor",
    };
  });
}

function deDiario(lista: readonly JournalEntry[]): EventoJornada[] {
  return lista
    .filter((e) => e.status === "saved")
    .map((e) => ({
      id: `diario:${e.id}`,
      tipo: EVENTO.DIARIO,
      dia: diaCivil(new Date(e.updatedAt)),
      ordem: e.updatedAt,
      // O titulo e da pessoa; o **conteudo** nunca aparece aqui.
      titulo: e.title.trim() ? `Diário — ${e.title.trim()}` : "Anotação no Diário",
      href: "/diario",
    }));
}

function deMetas(
  goals: readonly Goal[],
  progresso: readonly GoalProgressEntry[],
): EventoJornada[] {
  const titulos = new Map(goals.map((g) => [g.id, g.title]));
  return progresso
    // Progresso de meta apagada nao vira linha orfa na jornada.
    .filter((p) => titulos.has(p.goalId))
    .map((p) => ({
      id: `meta:${p.id}`,
      tipo: EVENTO.META,
      dia: p.day,
      ordem: `${p.day}T12:00:00`,
      titulo: `Meta — ${titulos.get(p.goalId)}`,
      href: "/metas",
    }));
}

function deCiclo(lista: readonly CycleDailyRecord[]): EventoJornada[] {
  return lista.map((r) => ({
    id: `ciclo:${r.id}`,
    tipo: EVENTO.CICLO,
    dia: r.date,
    ordem: `${r.date}T12:00:00`,
    // Nem fluxo nem sintoma no rotulo: o detalhe fica na tela do Ciclo.
    titulo: "Registro de ciclo",
    href: "/ciclo",
  }));
}

/**
 * A linha do tempo, do mais recente para o mais antigo.
 *
 * Empate de instante e desempatado pelo `id`, para a ordem ser **estavel** entre
 * renders — lista que embaralha sozinha faz a pessoa reprocurar o que ja tinha
 * achado.
 */
export function derivarLinhaDoTempo(estado: EstadoDaJornada): EventoJornada[] {
  const eventos = [
    ...deCheckins(estado.checkins),
    ...deSono(estado.sleep),
    ...deDiario(estado.journal),
    ...deMetas(estado.goals, estado.goalProgress),
    ...(estado.cicloAtivo ? deCiclo(estado.cycleRecords) : []),
  ];
  return eventos.sort((a, b) => {
    if (a.ordem !== b.ordem) return a.ordem < b.ordem ? 1 : -1;
    return a.id < b.id ? 1 : -1;
  });
}

export interface DiaAcompanhado {
  dia: string;
  total: number;
  tipos: TipoEvento[];
}

/**
 * Dias com registro, a partir da **mesma** sequencia.
 *
 * Dia sem registro simplesmente nao esta no mapa. Quem desenha decide como
 * mostrar ausencia — e a regra do produto e que ausencia **nao** e estado
 * negativo.
 */
export function derivarDiasAcompanhados(
  eventos: readonly EventoJornada[],
): Map<string, DiaAcompanhado> {
  const mapa = new Map<string, DiaAcompanhado>();
  for (const evento of eventos) {
    const atual = mapa.get(evento.dia);
    if (!atual) {
      mapa.set(evento.dia, { dia: evento.dia, total: 1, tipos: [evento.tipo] });
      continue;
    }
    atual.total += 1;
    if (!atual.tipos.includes(evento.tipo)) atual.tipos.push(evento.tipo);
  }
  return mapa;
}

/** Os dias civis de um mes (YYYY-MM), em ordem. */
export function diasDoMes(mes: string): string[] {
  const [ano, m] = mes.split("-").map(Number);
  if (!ano || !m) return [];
  const total = new Date(ano, m, 0).getDate();
  return Array.from(
    { length: total },
    (_, i) => `${mes}-${String(i + 1).padStart(2, "0")}`,
  );
}

/**
 * Intensidade do dia, em faixas nomeadas.
 *
 * Faixa **nomeada**, e nao um numero cru virando opacidade: o nome vira texto na
 * tela e no leitor de tela, e a cor passa a ser reforco, nunca a unica
 * informacao (WCAG 1.4.1).
 */
export type FaixaDeDia = "sem-registro" | "leve" | "media" | "intensa";

export function faixaDoDia(total: number): FaixaDeDia {
  if (total <= 0) return "sem-registro";
  if (total <= 2) return "leve";
  if (total <= 4) return "media";
  return "intensa";
}

export const FAIXA_LABEL: Record<FaixaDeDia, string> = {
  "sem-registro": "sem registro",
  leve: "1 a 2 registros",
  media: "3 a 4 registros",
  intensa: "5 registros ou mais",
};
