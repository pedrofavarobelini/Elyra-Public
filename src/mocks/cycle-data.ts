import type {
  CycleDailyRecord,
  CyclePeriod,
  CycleSymptom,
} from "@/lib/contracts/cycle";
import { addDays, toISODate } from "@/lib/cycle";
import { MOCK_USER } from "@/mocks/data";



export const today = (): string => toISODate(new Date());

/** Data civil deslocada em dias a partir de hoje. */
export function cycleDay0(offset: number): string {
  return addDays(today(), offset);
}

export const SYSTEM_SYMPTOMS: CycleSymptom[] = [
  { id: "sy-colica", label: "Cólica", origin: "system", ownerId: null },
  { id: "sy-cabeca", label: "Dor de cabeça", origin: "system", ownerId: null },
  { id: "sy-sensibilidade", label: "Sensibilidade", origin: "system", ownerId: null },
  { id: "sy-cansaco", label: "Cansaço", origin: "system", ownerId: null },
  { id: "sy-inchaco", label: "Inchaço", origin: "system", ownerId: null },
  { id: "sy-apetite", label: "Alteração de apetite", origin: "system", ownerId: null },
];

export const CUSTOM_SYMPTOMS: CycleSymptom[] = [
  {
    id: "sy-custom-enxaqueca",
    label: "Enxaqueca no fim do dia",
    origin: "custom",
    ownerId: MOCK_USER.id,
  },
];

/**
 * Tres periodos registrados. Inicios em -75, -47 e -19 dias: duracao media de
 * 28 dias e duracao media de periodo de 6 dias.
 */
export function mockPeriods(): CyclePeriod[] {
  return [
    { id: "cp-1", startDate: cycleDay0(-75), endDate: cycleDay0(-70) },
    { id: "cp-2", startDate: cycleDay0(-47), endDate: cycleDay0(-42) },
    { id: "cp-3", startDate: cycleDay0(-19), endDate: cycleDay0(-14) },
  ];
}


export function mockCycleRecords(): CycleDailyRecord[] {
  return [
    {
      id: "cr-1",
      date: cycleDay0(-19),
      flow: "medium",
      symptoms: [
        { symptomId: "sy-colica", severity: "moderada" },
        { symptomId: "sy-cansaco", severity: "intensa" },
      ],
      note: "Primeiro dia mais difícil que o normal.",
    },
    {
      id: "cr-2",
      date: cycleDay0(-18),
      flow: "heavy",
      symptoms: [{ symptomId: "sy-colica", severity: "intensa" }],
      note: null,
    },
    {
      id: "cr-3",
      date: cycleDay0(-17),
      flow: "medium",
      symptoms: [{ symptomId: "sy-cabeca", severity: "leve" }],
      note: null,
    },
    {
      id: "cr-4",
      date: cycleDay0(-16),
      flow: "light",
      symptoms: [],
      note: null,
    },
    {
      id: "cr-5",
      date: cycleDay0(-15),
      flow: "light",
      symptoms: [{ symptomId: "sy-sensibilidade", severity: "leve" }],
      note: null,
    },
    {
      id: "cr-6",
      date: cycleDay0(-14),
      flow: "spotting",
      symptoms: [],
      note: null,
    },
    {
      // Fora da menstruacao: sintoma sem fluxo e um registro valido.
      id: "cr-7",
      date: cycleDay0(-2),
      flow: null,
      symptoms: [
        { symptomId: "sy-cansaco", severity: "moderada" },
        { symptomId: "sy-inchaco", severity: "leve" },
      ],
      note: "Dia produtivo no trabalho, me senti mais cansada a noite.",
    },
  ];
}
