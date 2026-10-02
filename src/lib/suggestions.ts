import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import { FATO_HOJE, derivarHoje, diaCivil, type EstadoDeHoje } from "@/lib/today";



export const SUGESTAO = {
  CHECKIN_HOJE: "checkin_hoje",
  SONO_ABAIXO: "sono_abaixo",
  FATOR_RECENTE: "fator_recente",
} as const;

export type TipoSugestao = (typeof SUGESTAO)[keyof typeof SUGESTAO];

export interface Sugestao {
  id: TipoSugestao;
  /** O fato observado, na linguagem da pessoa. */
  texto: string;
  /** Convite para uma tela que ja existe. Nunca URL externa. */
  acao: { label: string; href: string };
}

export interface EstadoDasSugestoes extends EstadoDeHoje {
  sleep: readonly SleepRecord[];
  factors: readonly EmotionalFactor[];
}

/** Mediana da propria pessoa — nunca uma norma de "pessoa normal". */
function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenado = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  if (ordenado.length % 2 === 1) return ordenado[meio] ?? null;
  const a = ordenado[meio - 1];
  const b = ordenado[meio];
  return a === undefined || b === undefined ? null : (a + b) / 2;
}

/** Noites com duracao registrada, do mais recente para o mais antigo. */
function noitesComDuracao(sleep: readonly SleepRecord[]): SleepRecord[] {
  return sleep
    .filter((s) => s.durationMinutes !== null)
    .sort((a, b) => b.night.localeCompare(a.night));
}

/**
 * Sono da ultima noite abaixo do habitual **da propria pessoa**.
 *
 * Exige pelo menos cinco noites registradas: comparar com a mediana de duas
 * noites nao e comparar com habito nenhum, e o convite sairia sobre ruido.
 */
function sugestaoDeSono(
  sleep: readonly SleepRecord[],
  hoje: string,
): Sugestao | null {
  const noites = noitesComDuracao(sleep);
  if (noites.length < 5) return null;

  const ultima = noites[0]!;
  // So vale para a noite recem-passada: um registro de tres dias atras nao e "agora".
  const ontem = new Date(`${hoje}T12:00:00`);
  ontem.setDate(ontem.getDate() - 1);
  if (ultima.night !== hoje && ultima.night !== diaCivil(ontem)) return null;

  const anteriores = noites.slice(1).map((n) => n.durationMinutes!);
  const habitual = mediana(anteriores);
  if (habitual === null) return null;

  // Margem de 45 min: variacao menor que isso e ruido de quem anota no olho.
  if (ultima.durationMinutes! >= habitual - 45) return null;

  return {
    id: SUGESTAO.SONO_ABAIXO,
    texto:
      "Você registrou menos horas de sono do que costuma nas últimas noites.",
    acao: { label: "Registrar como estou", href: "/meu-humor" },
  };
}

/**
 * O fator mais marcado nos ultimos dias.
 *
 * Contado em **dias**, e nao em check-ins: quem marca "Trabalho" tres vezes num
 * dia nao teve tres dias de trabalho.
 */
function sugestaoDeFator(
  checkins: readonly EmotionalCheckin[],
  factors: readonly EmotionalFactor[],
  hoje: string,
): Sugestao | null {
  const inicio = new Date(`${hoje}T12:00:00`);
  inicio.setDate(inicio.getDate() - 13);
  const desde = diaCivil(inicio);

  const rotulos = new Map(factors.map((f) => [f.id, f.label]));
  const diasPorFator = new Map<string, Set<string>>();

  for (const checkin of checkins) {
    const dia = diaCivil(new Date(checkin.occurredAt));
    if (dia < desde || dia > hoje) continue;
    for (const id of checkin.factorIds) {
      if (!rotulos.has(id)) continue;
      const dias = diasPorFator.get(id) ?? new Set<string>();
      dias.add(dia);
      diasPorFator.set(id, dias);
    }
  }

  let escolhido: { id: string; dias: number } | null = null;
  for (const [id, dias] of diasPorFator) {
    if (!escolhido || dias.size > escolhido.dias) escolhido = { id, dias: dias.size };
    // Empate mantem o primeiro em ordem de id, para a sugestao nao alternar sozinha.
    else if (dias.size === escolhido.dias && id < escolhido.id) escolhido = { id, dias: dias.size };
  }

  // Menos de tres dias nao e "recorrente" — e coincidencia.
  if (!escolhido || escolhido.dias < 3) return null;

  return {
    id: SUGESTAO.FATOR_RECENTE,
    texto: `Você marcou "${rotulos.get(escolhido.id)}" em ${escolhido.dias} dias recentes.`,
    acao: { label: "Ver esses dias", href: "/relatorios" },
  };
}

/**
 * As sugestoes de agora, em ordem fixa e no maximo duas.
 *
 * Duas, e nao todas: uma lista longa de convites e uma lista de tarefas, e a
 * Elyra nao distribui tarefas. A ordem e fixa para a tela nao se reorganizar
 * entre visitas.
 */
export function sugerir(
  estado: EstadoDasSugestoes,
  agora: Date = new Date(),
): Sugestao[] {
  const hoje = diaCivil(agora);
  const sugestoes: Sugestao[] = [];

  // Fato vindo do MESMO motor do "Hoje na Elyra" — nunca recontado aqui.
  const faltaCheckin =
    derivarHoje(estado, agora).find((f) => f.tipo === FATO_HOJE.CHECKIN)?.tom ===
    "convite";
  if (faltaCheckin) {
    sugestoes.push({
      id: SUGESTAO.CHECKIN_HOJE,
      texto: "Você ainda não registrou como está hoje.",
      acao: { label: "Fazer check-in", href: "/meu-humor" },
    });
  }

  const sono = sugestaoDeSono(estado.sleep, hoje);
  if (sono) sugestoes.push(sono);

  const fator = sugestaoDeFator(estado.checkins, estado.factors, hoje);
  if (fator) sugestoes.push(fator);

  return sugestoes.slice(0, 2);
}
