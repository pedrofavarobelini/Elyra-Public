import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import type { CycleDailyRecord } from "@/lib/contracts/cycle";
import { diaCivil } from "@/lib/today";



export interface IntervaloSemana {
  /** Segunda-feira, em dia civil. */
  inicio: string;
  /** Domingo, em dia civil. */
  fim: string;
}

export interface EstadoDaSemana {
  checkins: readonly EmotionalCheckin[];
  sleep: readonly SleepRecord[];
  journal: readonly JournalEntry[];
  goals: readonly Goal[];
  goalProgress: readonly GoalProgressEntry[];
  factors: readonly EmotionalFactor[];
  cycleRecords: readonly CycleDailyRecord[];
  cicloAtivo: boolean;
}

export interface ContagemSemana {
  checkins: number;
  diasComCheckin: number;
  anotacoes: number;
  noitesDeSono: number;
  metasComProgresso: number;
  metasAtivas: number;
  registrosDeCiclo: number;
}

export interface ResumoSemana extends IntervaloSemana {
  contagem: ContagemSemana;
  /** Fatores mais marcados, do mais ao menos frequente (ate 3). */
  fatores: Array<{ label: string; total: number }>;
  /** Dominios sem nenhum registro na semana. Informacao, nao cobranca. */
  semRegistro: string[];
  /** Diferenca de contagem em relacao a semana anterior. */
  variacao: { checkins: number; anotacoes: number; noitesDeSono: number };
  /** Ha qualquer registro nesta semana? */
  vazia: boolean;
}

/** Segunda a domingo que contem a data de referencia. */
export function semanaDe(referencia: Date): IntervaloSemana {
  const base = new Date(referencia);
  // `getDay()` devolve 0 para domingo; a semana da Elyra comeca na segunda.
  const deslocamento = (base.getDay() + 6) % 7;
  const segunda = new Date(base);
  segunda.setDate(base.getDate() - deslocamento);
  const domingo = new Date(segunda);
  domingo.setDate(segunda.getDate() + 6);
  return { inicio: diaCivil(segunda), fim: diaCivil(domingo) };
}

/** A semana imediatamente anterior a informada. */
export function semanaAnterior(semana: IntervaloSemana): IntervaloSemana {
  const segunda = new Date(`${semana.inicio}T12:00:00`);
  segunda.setDate(segunda.getDate() - 7);
  return semanaDe(segunda);
}

const dentro = (dia: string, semana: IntervaloSemana) =>
  dia >= semana.inicio && dia <= semana.fim;

function contar(estado: EstadoDaSemana, semana: IntervaloSemana): ContagemSemana {
  const checkins = estado.checkins.filter((c) =>
    dentro(diaCivil(new Date(c.occurredAt)), semana),
  );
  const diasComCheckin = new Set(
    checkins.map((c) => diaCivil(new Date(c.occurredAt))),
  ).size;

  const anotacoes = estado.journal.filter(
    (e) => e.status === "saved" && dentro(diaCivil(new Date(e.updatedAt)), semana),
  ).length;

  const noitesDeSono = estado.sleep.filter((s) => dentro(s.night, semana)).length;

  const ativas = estado.goals.filter((g) => g.status === "active");
  const comProgresso = new Set(
    estado.goalProgress
      .filter((p) => dentro(p.day, semana))
      .map((p) => p.goalId),
  );
  const metasComProgresso = ativas.filter((g) => comProgresso.has(g.id)).length;

  const registrosDeCiclo = estado.cicloAtivo
    ? estado.cycleRecords.filter((r) => dentro(r.date, semana)).length
    : 0;

  return {
    checkins: checkins.length,
    diasComCheckin,
    anotacoes,
    noitesDeSono,
    metasComProgresso,
    metasAtivas: ativas.length,
    registrosDeCiclo,
  };
}

function fatoresDaSemana(
  estado: EstadoDaSemana,
  semana: IntervaloSemana,
): Array<{ label: string; total: number }> {
  const rotulos = new Map(estado.factors.map((f) => [f.id, f.label]));
  const total = new Map<string, number>();
  for (const checkin of estado.checkins) {
    if (!dentro(diaCivil(new Date(checkin.occurredAt)), semana)) continue;
    for (const id of checkin.factorIds) {
      // Fator apagado nao vira linha sem nome.
      if (!rotulos.has(id)) continue;
      total.set(id, (total.get(id) ?? 0) + 1);
    }
  }
  return [...total.entries()]
    .map(([id, qtd]) => ({ label: rotulos.get(id)!, total: qtd }))
    // Empate resolvido pelo rotulo: a lista nao pode trocar de ordem sozinha.
    .sort((a, b) => (b.total !== a.total ? b.total - a.total : a.label.localeCompare(b.label)))
    .slice(0, 3);
}

export function derivarSemana(
  estado: EstadoDaSemana,
  referencia: Date = new Date(),
): ResumoSemana {
  const semana = semanaDe(referencia);
  const contagem = contar(estado, semana);
  const anterior = contar(estado, semanaAnterior(semana));

  const semRegistro: string[] = [];
  if (contagem.checkins === 0) semRegistro.push("check-ins");
  if (contagem.noitesDeSono === 0) semRegistro.push("sono");
  if (contagem.anotacoes === 0) semRegistro.push("Diário");
  if (contagem.metasAtivas > 0 && contagem.metasComProgresso === 0) {
    semRegistro.push("progresso de metas");
  }
  if (estado.cicloAtivo && contagem.registrosDeCiclo === 0) {
    semRegistro.push("ciclo");
  }

  return {
    ...semana,
    contagem,
    fatores: fatoresDaSemana(estado, semana),
    semRegistro,
    variacao: {
      checkins: contagem.checkins - anterior.checkins,
      anotacoes: contagem.anotacoes - anterior.anotacoes,
      noitesDeSono: contagem.noitesDeSono - anterior.noitesDeSono,
    },
    vazia:
      contagem.checkins === 0 &&
      contagem.anotacoes === 0 &&
      contagem.noitesDeSono === 0 &&
      contagem.metasComProgresso === 0 &&
      contagem.registrosDeCiclo === 0,
  };
}

const plural = (n: number, um: string, muitos: string) =>
  `${n} ${n === 1 ? um : muitos}`;

/**
 * O resumo em frases — deterministico, sem IA.
 *
 * Cada frase e uma contagem. Nenhuma avalia a semana, porque contar registros
 * nao diz como alguem esteve: uma semana com poucos registros pode ter sido
 * otima. O produto conta; quem interpreta e a pessoa.
 */
export function resumoEmTexto(resumo: ResumoSemana): string[] {
  if (resumo.vazia) {
    // Vazio explicado, sem culpa e sem "voce nao fez nada".
    return ["Ainda não há registros nesta semana."];
  }

  const frases: string[] = [];
  const { contagem } = resumo;

  if (contagem.checkins > 0) {
    frases.push(
      contagem.diasComCheckin === contagem.checkins
        ? `${plural(contagem.checkins, "check-in", "check-ins")} em ${plural(contagem.diasComCheckin, "dia", "dias")}.`
        : `${plural(contagem.checkins, "check-in", "check-ins")}, distribuídos em ${plural(contagem.diasComCheckin, "dia", "dias")}.`,
    );
  }
  if (contagem.noitesDeSono > 0) {
    frases.push(`${plural(contagem.noitesDeSono, "noite registrada", "noites registradas")} de sono.`);
  }
  if (contagem.anotacoes > 0) {
    frases.push(`${plural(contagem.anotacoes, "anotação", "anotações")} no Diário.`);
  }
  if (contagem.metasAtivas > 0) {
    frases.push(
      contagem.metasComProgresso === 0
        ? `Nenhuma das ${plural(contagem.metasAtivas, "meta ativa", "metas ativas")} recebeu progresso nesta semana.`
        : `${plural(contagem.metasComProgresso, "meta avançou", "metas avançaram")} — de ${plural(contagem.metasAtivas, "meta ativa", "metas ativas")}.`,
    );
  }
  if (contagem.registrosDeCiclo > 0) {
    frases.push(`${plural(contagem.registrosDeCiclo, "registro", "registros")} de ciclo.`);
  }
  if (resumo.fatores.length > 0) {
    frases.push(
      `Fatores mais marcados: ${resumo.fatores.map((f) => f.label).join(", ")}.`,
    );
  }

  const variacao = resumo.variacao.checkins;
  if (variacao !== 0 && Math.abs(variacao) >= 1) {
    /*
      Diferenca de contagem, e nao julgamento. "a mais"/"a menos" descreve o
      numero; "melhor"/"pior" descreveria a pessoa.
    */
    frases.push(
      variacao > 0
        ? `${plural(variacao, "check-in a mais", "check-ins a mais")} que na semana anterior.`
        : `${plural(Math.abs(variacao), "check-in a menos", "check-ins a menos")} que na semana anterior.`,
    );
  }

  if (resumo.semRegistro.length > 0) {
    frases.push(`Sem registros de ${resumo.semRegistro.join(", ")} nesta semana.`);
  }

  return frases;
}

/** "15 a 21 de setembro" — o intervalo por extenso. */
export function intervaloEmTexto(semana: IntervaloSemana): string {
  const inicio = new Date(`${semana.inicio}T12:00:00`);
  const fim = new Date(`${semana.fim}T12:00:00`);
  const dia = new Intl.DateTimeFormat("pt-BR", { day: "numeric" });
  const diaMes = new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long" });
  return inicio.getMonth() === fim.getMonth()
    ? `${dia.format(inicio)} a ${diaMes.format(fim)}`
    : `${diaMes.format(inicio)} a ${diaMes.format(fim)}`;
}
