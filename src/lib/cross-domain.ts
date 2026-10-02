import type { DayGroupInput } from "@/lib/associations";
import type { EmotionalCheckin, EmotionalFactor, SleepRecord } from "@/lib/contracts/emotional";
import type { GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry } from "@/lib/contracts/journal";
import { civilDateInTimeZone, type AnalyticsWindow } from "@/lib/reports";

/**
 * Converte cada dominio num **conjunto de dias**, que e a unica coisa que o
 * motor de coocorrencia precisa saber.
 *
 * A separacao e deliberada: `buildDayGroupAssociation` nao sabe o que e uma
 * meta, um diario ou um fator - so recebe "estes dias sim, aqueles nao". Isso
 * mantem a regra de calculo unica para todos os cruzamentos, em vez de uma
 * variante por dominio que lentamente diverge.
 *
 * Todos os dias saem em data civil no fuso da pessoa. Um registro feito as 23h
 * pertence ao dia dela, nao ao dia UTC.
 */
export interface CrossDomainInput {
  window: AnalyticsWindow;
  timeZone: string;
  checkins: EmotionalCheckin[];
  sleep: SleepRecord[];
  factors: EmotionalFactor[];
  journal: JournalEntry[];
  goalProgress: GoalProgressEntry[];
}

function inWindow(date: string, window: AnalyticsWindow): boolean {
  return date >= window.from && date <= window.to;
}

function civilDay(iso: string, timeZone: string): string {
  return civilDateInTimeZone(new Date(iso), timeZone);
}

/**
 * Mediana da **propria** pessoa, na janela.
 *
 * Nunca uma norma populacional: o produto nao tem, e nao deve ter, uma media de
 * "pessoa normal". "Dormiu mais" aqui significa "mais do que voce costuma
 * dormir nesta janela", e nada alem disso.
 */
function medianOf(values: number[]): number | null {
  if (values.length === 0) return null;
  const ordenado = [...values].sort((a, b) => a - b);
  const meio = Math.floor(ordenado.length / 2);
  if (ordenado.length % 2 === 1) return ordenado[meio] ?? null;
  const a = ordenado[meio - 1];
  const b = ordenado[meio];
  return a === undefined || b === undefined ? null : (a + b) / 2;
}

export function buildCrossDomainInputs(input: CrossDomainInput): DayGroupInput[] {
  const { window, timeZone } = input;
  const cruzamentos: DayGroupInput[] = [];

  // --- Diario x humor -----------------------------------------------------
  const diasComDiario = new Set(
    input.journal
      .filter((entry) => entry.status === "saved" && entry.trashedAt === null)
      .map((entry) => civilDay(entry.createdAt, timeZone))
      .filter((day) => inWindow(day, window)),
  );
  if (diasComDiario.size > 0) {
    cruzamentos.push({
      id: "diario-humor",
      question: "Escrever no diário aparece junto com dias melhores?",
      metric: "mood",
      withLabel: "Escrevi no diário",
      withoutLabel: "Não escrevi",
      days: diasComDiario,
    });
  }

  // --- Metas x energia ----------------------------------------------------
  const diasComMeta = new Set(
    input.goalProgress
      .map((entry) => entry.day)
      .filter((day) => inWindow(day, window)),
  );
  if (diasComMeta.size > 0) {
    cruzamentos.push({
      id: "metas-energia",
      question: "Registrar progresso em metas aparece junto com mais energia?",
      metric: "energy",
      withLabel: "Registrei progresso",
      withoutLabel: "Não registrei",
      days: diasComMeta,
    });
  }

  // --- Sono x humor -------------------------------------------------------
  const duracoes = input.sleep
    .filter((record) => inWindow(record.night, window))
    .map((record) => record.durationMinutes)
    .filter((value): value is number => value !== null);
  const mediana = medianOf(duracoes);
  if (mediana !== null) {
    const diasDormiMais = new Set(
      input.sleep
        .filter(
          (record) =>
            inWindow(record.night, window) &&
            record.durationMinutes !== null &&
            record.durationMinutes >= mediana,
        )
        .map((record) => record.night),
    );
    if (diasDormiMais.size > 0) {
      cruzamentos.push({
        id: "sono-humor",
        question: "Dormir mais do que o seu habitual aparece junto com dias melhores?",
        metric: "mood",
        withLabel: "Dormi mais que o seu habitual",
        withoutLabel: "Dormi menos",
        days: diasDormiMais,
      });
    }
  }

  // --- Fator mais registrado x humor --------------------------------------
  // Reaproveita `buildFactorFrequency` em vez de recontar: uma fonte so, e com
  // o desempate por rotulo que o laco anterior nao tinha - sem ele, dois
  // fatores com a mesma contagem podiam trocar de lugar entre renders.
  const [maisRegistrado] = buildFactorFrequency(input);
  if (maisRegistrado) {
    const diasDoFator = new Set(
      input.checkins
        .filter((checkin) => checkin.factorIds.includes(maisRegistrado.factorId))
        .map((checkin) => civilDay(checkin.occurredAt, timeZone))
        .filter((day) => inWindow(day, window)),
    );
    cruzamentos.push({
      id: "fator-humor",
      question: `Registrar "${maisRegistrado.label}" aparece junto com dias melhores ou piores?`,
      metric: "mood",
      withLabel: `Registrei "${maisRegistrado.label}"`,
      withoutLabel: "Não registrei",
      days: diasDoFator,
    });
  }

  return cruzamentos;
}

/**
 * Frequencia de fatores na janela, em dias - nao em numero de check-ins.
 *
 * A unidade importa: quem registra "Trabalho" tres vezes no mesmo dia nao teve
 * tres dias de trabalho. Contar check-ins inflaria o fator de quem registra mais
 * vezes por dia, e a comparacao entre fatores passaria a medir habito de
 * registro em vez de presenca do fator.
 *
 * Frequencia e **contagem observada**, nao interpretacao: nao ordena por
 * "importancia" nem sugere efeito. Diz apenas em quantos dias o fator apareceu.
 */
export interface FactorFrequency {
  factorId: string;
  label: string;
  days: number;
}

export function buildFactorFrequency(
  input: Pick<CrossDomainInput, "window" | "timeZone" | "checkins" | "factors">,
): FactorFrequency[] {
  const porFator = new Map<string, Set<string>>();
  for (const checkin of input.checkins) {
    const day = civilDay(checkin.occurredAt, input.timeZone);
    if (!inWindow(day, input.window)) continue;
    for (const factorId of checkin.factorIds) {
      const dias = porFator.get(factorId) ?? new Set<string>();
      dias.add(day);
      porFator.set(factorId, dias);
    }
  }

  return [...porFator.entries()]
    .map(([factorId, dias]) => ({
      factorId,
      label:
        input.factors.find((factor) => factor.id === factorId)?.label ??
        "Fator removido",
      days: dias.size,
    }))
    // Empate resolvido pelo rotulo: sem isso a ordem mudaria entre renders e a
    // lista pareceria instavel sem nenhum dado ter mudado.
    .sort((a, b) => b.days - a.days || a.label.localeCompare(b.label, "pt-BR"));
}

/**
 * Em quantos dias da janela houve progresso registrado em alguma meta.
 *
 * Dias, e nao entradas: registrar duas metas no mesmo dia e um dia com
 * progresso. E ausencia de registro nao e zero de progresso - e ausencia de
 * registro, que e o que a tela precisa dizer.
 */
export function daysWithGoalProgress(
  input: Pick<CrossDomainInput, "window" | "goalProgress">,
): number {
  return new Set(
    input.goalProgress
      .map((entry) => entry.day)
      .filter((day) => inWindow(day, input.window)),
  ).size;
}
