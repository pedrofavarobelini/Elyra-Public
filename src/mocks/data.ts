import type {
  EmotionalCheckin,
  EmotionalFactor,
  PrimaryFeeling,
  SleepRecord,
} from "@/lib/contracts/emotional";
import type { Goal, GoalProgressEntry } from "@/lib/contracts/goals";
import type { JournalEntry, JournalTag } from "@/lib/contracts/journal";
import { toDay } from "@/lib/contracts/goals";



export const MOCK_USER = {
  id: "user-mock-1",
  name: "Demo",
  initials: "P",
  email: "pedro@example.test",
} as const;

/**
 * Instante sintetico do seed.
 *
 * Duas garantias, e a segunda existe por causa de um bug real:
 *
 *  1. **Nunca no futuro.** Um registro a frente do relogio ordenaria acima de um
 *     check-in recem-criado pelo usuario.
 *  2. **Ordem relativa preservada dentro do mesmo dia.** A primeira versao desta
 *     funcao recuava cada instante individualmente, entao as 09h da manha o
 *     registro "de hoje as 19:10" caia para ontem enquanto o "de hoje as 08:30"
 *     ficava - invertendo a ordem e destruindo o proprio invariante que o seed
 *     queria demonstrar (multiplos check-ins no mesmo dia).
 *
 * Para `daysAgo === 0`, a hora pedida e tratada como **posicao no dia** e
 * projetada na janela ja decorrida: `inicio_do_dia + fracao * (agora - inicio)`.
 * Assim todos os registros de hoje continuam sendo de hoje, continuam no
 * passado e mantem a ordem entre si.
 *
 * Dias anteriores usam a hora do relogio diretamente - ja estao no passado.
 */
export function at(daysAgo: number, hour = 9, minute = 0): string {
  const now = new Date();

  if (daysAgo === 0) {
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);

    const elapsed = now.getTime() - startOfDay.getTime();
    const fraction = (hour * 60 + minute) / (24 * 60);

    return new Date(startOfDay.getTime() + fraction * elapsed).toISOString();
  }

  const d = new Date(now);
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function day(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return toDay(d);
}

/**
 * Historico sintetico mais longo, para as telas de ciclo e relatorios.
 *
 * Deterministico de proposito: os valores vem de uma funcao do proprio indice,
 * nao de aleatoriedade. Uma serie que muda a cada carga produziria QA visual
 * intermitente e testes que passam por sorte.
 *
 * Dias 8, 16, 24, ... ficam **sem registro** para que a lacuna exista de fato -
 * um historico artificialmente completo esconderia o caminho da ausencia.
 */
function historyCheckins(oldestDaysAgo: number, newestDaysAgo: number): EmotionalCheckin[] {
  const out: EmotionalCheckin[] = [];
  for (let d = newestDaysAgo; d <= oldestDaysAgo; d += 1) {
    if (d % 8 === 0) continue;
    const wave = Math.sin(d / 4.5);
    const mood = clampScore(6 + Math.round(wave * 2));
    const anxiety = clampScore(5 - Math.round(wave * 2));
    const energy = clampScore(6 + Math.round(Math.cos(d / 5) * 2));
    out.push({
      id: `c-h${d}`,
      occurredAt: at(d, 9 + (d % 3) * 4, (d * 7) % 60),
      mood,
      perceivedAnxiety: anxiety,
      energy,
      primaryFeeling: FEELING_CYCLE[d % FEELING_CYCLE.length] as PrimaryFeeling,
      factorIds: [],
      note: null,
    });
  }
  return out;
}

function historySleep(oldestDaysAgo: number, newestDaysAgo: number): SleepRecord[] {
  const out: SleepRecord[] = [];
  for (let d = newestDaysAgo; d <= oldestDaysAgo; d += 1) {
    if (d % 8 === 0) continue;
    const minutes = 360 + ((d * 13) % 7) * 15;
    out.push({
      id: `s-h${d}`,
      night: day(d),
      durationMinutes: minutes,
      quality: clampScore(5 + Math.round(Math.sin(d / 4) * 2)),
    });
  }
  return out;
}

const FEELING_CYCLE = [
  "tranquilo",
  "feliz",
  "neutro",
  "ansioso",
  "triste",
] as const;

function clampScore(value: number): number {
  return Math.max(0, Math.min(10, value));
}

export const SYSTEM_FACTORS: EmotionalFactor[] = [
  { id: "10000000-0000-4000-8000-000000000001", label: "Trabalho", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000002", label: "Estudos", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000003", label: "Sono", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000004", label: "Exercício", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000005", label: "Família", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000006", label: "Saúde", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000007", label: "Finanças", origin: "system", ownerId: null },
  { id: "10000000-0000-4000-8000-000000000008", label: "Vida social", origin: "system", ownerId: null },
];

export const CUSTOM_FACTORS: EmotionalFactor[] = [
  {
    id: "20000000-0000-4000-8000-000000000001",
    label: "Terapia",
    origin: "custom",
    ownerId: MOCK_USER.id,
  },
];

export const MOCK_CHECKINS: EmotionalCheckin[] = [
  {
    id: "c-1",
    occurredAt: at(0, 8, 30),
    mood: 7,
    perceivedAnxiety: 4,
    energy: 7,
    primaryFeeling: "tranquilo",
    factorIds: ["10000000-0000-4000-8000-000000000003", "10000000-0000-4000-8000-000000000004"],
    note: null,
  },
  {
    // Segundo check-in do mesmo dia: multiplos por dia sao validos.
    id: "c-2",
    occurredAt: at(0, 19, 10),
    mood: 8,
    perceivedAnxiety: 3,
    energy: 6,
    primaryFeeling: "feliz",
    factorIds: ["10000000-0000-4000-8000-000000000008"],
    note: "Dia rendeu bem.",
  },
  {
    id: "c-3",
    occurredAt: at(1, 9, 0),
    mood: 6,
    perceivedAnxiety: 5,
    energy: 5,
    primaryFeeling: "neutro",
    factorIds: ["10000000-0000-4000-8000-000000000001"],
    note: null,
  },
  {
    id: "c-4",
    occurredAt: at(2, 21, 0),
    mood: 5,
    perceivedAnxiety: 6,
    energy: 4,
    primaryFeeling: "ansioso",
    factorIds: ["10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"],
    note: null,
  },
  {
    // Energia ausente de proposito: NULL nao e zero.
    id: "c-5",
    occurredAt: at(3, 10, 0),
    mood: 7,
    perceivedAnxiety: 4,
    energy: null,
    primaryFeeling: "tranquilo",
    factorIds: [],
    note: null,
  },
  {
    id: "c-6",
    occurredAt: at(4, 9, 30),
    mood: 4,
    perceivedAnxiety: 7,
    energy: 3,
    primaryFeeling: "triste",
    factorIds: ["10000000-0000-4000-8000-000000000003", "10000000-0000-4000-8000-000000000006"],
    note: null,
  },
  {
    id: "c-7",
    occurredAt: at(6, 9, 0),
    mood: 6,
    perceivedAnxiety: 5,
    energy: 6,
    primaryFeeling: "neutro",
    factorIds: ["10000000-0000-4000-8000-000000000002"],
    note: null,
  },
  // Historico mais antigo, gerado de forma deterministica.
  ...historyCheckins(84, 7),
];

export const MOCK_SLEEP: SleepRecord[] = [
  { id: "s-1", night: day(0), durationMinutes: 432, quality: 8 },
  { id: "s-2", night: day(1), durationMinutes: 390, quality: 7 },
  { id: "s-3", night: day(2), durationMinutes: 348, quality: 5 },
  // Qualidade ausente: o usuario registrou a duracao e nao avaliou.
  { id: "s-4", night: day(3), durationMinutes: 465, quality: null },
  { id: "s-5", night: day(4), durationMinutes: 300, quality: 4 },
  { id: "s-6", night: day(6), durationMinutes: 420, quality: 7 },
  ...historySleep(84, 7),
];

export const SYSTEM_TAGS: JournalTag[] = [
  { id: "t-gratidao", label: "Gratidão", origin: "system", ownerId: null },
  { id: "t-trabalho", label: "Trabalho", origin: "system", ownerId: null },
  { id: "t-reflexao", label: "Reflexão", origin: "system", ownerId: null },
  { id: "t-relacoes", label: "Relações", origin: "system", ownerId: null },
];

export const CUSTOM_TAGS: JournalTag[] = [
  { id: "t-custom-corrida", label: "Corrida", origin: "custom", ownerId: MOCK_USER.id },
];

export const MOCK_JOURNAL: JournalEntry[] = [
  {
    id: "j-1",
    title: "Semana puxada",
    content:
      "Tive varias reunioes seguidas e isso me deixou cansado. Ainda assim consegui fechar duas entregas importantes.",
    status: "saved",
    tagIds: ["t-trabalho", "t-reflexao"],
    createdAt: at(0, 21, 0),
    updatedAt: at(0, 21, 30),
    trashedAt: null,
  },
  {
    id: "j-2",
    title: "Corrida no parque",
    content: "Sai para correr de manhã. Voltei com a cabeça bem mais leve.",
    status: "saved",
    tagIds: ["t-custom-corrida", "t-gratidao"],
    createdAt: at(2, 8, 0),
    updatedAt: at(2, 8, 20),
    trashedAt: null,
  },
  {
    id: "j-3",
    title: "",
    content: "Comecei a escrever e parei no meio",
    status: "draft",
    tagIds: [],
    createdAt: at(1, 22, 0),
    updatedAt: at(1, 22, 5),
    trashedAt: null,
  },
  {
    id: "j-4",
    title: "Anotacao antiga",
    content: "Registro que mandei para a lixeira.",
    status: "saved",
    tagIds: [],
    createdAt: at(10, 12, 0),
    updatedAt: at(10, 12, 0),
    trashedAt: at(3, 12, 0),
  },
];

export const MOCK_GOALS: Goal[] = [
  {
    id: "g-1",
    title: "Dormir melhor",
    kind: "frequency",
    status: "active",
    recurrence: "weekly",
    target: 7,
    unit: null,
    createdAt: at(30),
  },
  {
    id: "g-2",
    title: "Meditar",
    kind: "quantitative",
    status: "active",
    recurrence: "daily",
    target: 10,
    unit: "min",
    createdAt: at(20),
  },
  {
    id: "g-3",
    title: "Ler antes de dormir",
    kind: "frequency",
    status: "paused",
    recurrence: "weekly",
    target: 5,
    unit: null,
    createdAt: at(45),
  },
];

export const MOCK_GOAL_PROGRESS: GoalProgressEntry[] = [
  { id: "p-1", goalId: "g-1", day: day(0), amount: 1 },
  { id: "p-2", goalId: "g-1", day: day(1), amount: 1 },
  { id: "p-3", goalId: "g-1", day: day(2), amount: 1 },
  { id: "p-4", goalId: "g-2", day: day(0), amount: 10 },
  { id: "p-5", goalId: "g-2", day: day(1), amount: 5 },
  { id: "p-6", goalId: "g-2", day: day(2), amount: 10 },
  { id: "p-7", goalId: "g-2", day: day(3), amount: 10 },
];
