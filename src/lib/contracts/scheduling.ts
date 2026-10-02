import { z } from "zod";
import { addCivilDays, civilWeekStart, isCivilDate } from "@/lib/scheduling/calendar";



/** Mesmo recorte do banco (`scheduling_timezone_is_valid`): so regioes. */
export const IANA_REGION_PATTERN =
  /^(Africa|America|Antarctica|Asia|Atlantic|Australia|Europe|Indian|Pacific)\/[A-Za-z0-9_+-]+(\/[A-Za-z0-9_+-]+)?$/;

/** O runtime conhece o fuso? (o banco confere de novo contra `pg_timezone_names`). */
export function isKnownTimezone(value: string): boolean {
  if (!IANA_REGION_PATTERN.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isKnownTimezone, "Escolha um fuso horário da lista (ex.: America/Sao_Paulo).");

export const MODALITIES = ["online", "in_person"] as const;
export const modalitySchema = z.enum(MODALITIES);
export type Modality = z.infer<typeof modalitySchema>;

export const MODALITY_LABEL: Record<Modality, string> = {
  online: "Online",
  in_person: "Presencial",
};

export const SLOT_MINUTES = [30, 45, 50, 60, 90] as const;

export const WEEKDAY_LABEL = [
  "Domingo",
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
] as const;

/** Limite do banco: 28 regras por profissional. */
export const MAX_AVAILABILITY_RULES = 28;

export const availabilityRuleSchema = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: z.number().int().min(1).max(1440),
    slotMinutes: z.union([
      z.literal(30),
      z.literal(45),
      z.literal(50),
      z.literal(60),
      z.literal(90),
    ]),
    modality: modalitySchema,
  })
  .strict()
  .refine(
    (rule) => rule.endMinute - rule.startMinute >= rule.slotMinutes,
    "O intervalo precisa caber ao menos um horário.",
  );

export type AvailabilityRule = z.infer<typeof availabilityRuleSchema>;

export const availabilityInputSchema = z
  .object({
    timezone: timezoneSchema,
    rules: z.array(availabilityRuleSchema).max(MAX_AVAILABILITY_RULES, "No máximo 28 intervalos."),
  })
  .strict();

export type AvailabilityInput = z.infer<typeof availabilityInputSchema>;

export const availabilitySchema = z
  .object({
    timezone: z.string().nullable(),
    rules: z.array(availabilityRuleSchema),
  })
  .strict();

export type Availability = z.infer<typeof availabilitySchema>;

/** Sobreposicao no mesmo dia, detectada tambem no cliente para a mensagem. */
export function findOverlappingRule(rules: AvailabilityRule[]): number | null {
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i];
      const b = rules[j];
      if (!a || !b) continue;
      if (a.weekday === b.weekday && a.startMinute < b.endMinute && b.startMinute < a.endMinute) {
        return j;
      }
    }
  }
  return null;
}

/**
 * Excecoes da agenda (UX F6, D-UX-5): abertura avulsa ou bloqueio por data ou
 * periodo. ADR-0035: horarios = aberturas FINITAS MENOS bloqueios. Sem motivo em
 * texto livre. Bloquear nao cancela horario marcado: vira conflito listado.
 */
export const AVAILABILITY_EXCEPTION_KINDS = ["open", "block"] as const;
export type AvailabilityExceptionKind = (typeof AVAILABILITY_EXCEPTION_KINDS)[number];

/** Limites do banco (`save_professional_availability_exception`). */
export const EXCEPTION_OPEN_HORIZON_DAYS = 60;
export const EXCEPTION_BLOCK_HORIZON_DAYS = 366;

export const isoDateSchema = z.string().refine(isCivilDate, "Data inválida.");
const slotMinutesSchema = z.union([z.literal(30), z.literal(45), z.literal(50), z.literal(60), z.literal(90)]);

export const availabilityExceptionInputSchema = z
  .object({
    timezone: timezoneSchema,
    kind: z.enum(AVAILABILITY_EXCEPTION_KINDS),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    startMinute: z.number().int().min(0).max(1439).nullable(),
    endMinute: z.number().int().min(1).max(1440).nullable(),
    slotMinutes: slotMinutesSchema.nullable(),
    modality: modalitySchema.nullable(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endsOn < value.startsOn) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "A data final precisa ser igual ou depois da inicial." });
    }
    if ((value.startMinute === null) !== (value.endMinute === null)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Informe início e fim, ou nenhum dos dois (dia inteiro)." });
    }
    if (value.startMinute !== null && value.endMinute !== null && value.endMinute <= value.startMinute) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "O fim precisa ser depois do início." });
    }
    if (value.kind === "open") {
      if (value.startMinute === null || value.endMinute === null || value.slotMinutes === null || value.modality === null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Abertura precisa de início, fim, duração e modalidade." });
      } else if (value.endMinute - value.startMinute < value.slotMinutes) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: "O intervalo precisa caber ao menos um horário." });
      }
    } else if (value.slotMinutes !== null || value.modality !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Bloqueio vale para qualquer duração e modalidade." });
    }
  });

export type AvailabilityExceptionInput = z.infer<typeof availabilityExceptionInputSchema>;

export const availabilityExceptionSchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(AVAILABILITY_EXCEPTION_KINDS),
    startsOn: isoDateSchema,
    endsOn: isoDateSchema,
    startMinute: z.number().int().nullable(),
    endMinute: z.number().int().nullable(),
    slotMinutes: slotMinutesSchema.nullable(),
    modality: modalitySchema.nullable(),
    timezone: z.string(),
  })
  .strict();

export type AvailabilityException = z.infer<typeof availabilityExceptionSchema>;

export const availabilityConflictSchema = z
  .object({
    exceptionId: z.string().uuid(),
    appointmentId: z.string().uuid(),
    startsAt: z.string(),
    endsAt: z.string(),
    status: z.enum(["requested", "confirmed"]),
  })
  .strict();

export type AvailabilityConflict = z.infer<typeof availabilityConflictSchema>;

export const availabilityExceptionsSchema = z
  .object({
    exceptions: z.array(availabilityExceptionSchema),
    conflicts: z.array(availabilityConflictSchema),
  })
  .strict();

export type AvailabilityExceptions = z.infer<typeof availabilityExceptionsSchema>;


export const SCHEDULING_MIN_LEAD_MINUTES = 60;
export const SCHEDULING_HORIZON_DAYS = 60;
export const SCHEDULING_LEAD_COPY =
  "Pedidos precisam de pelo menos 1 hora de antecedência e podem ser feitos até 60 dias à frente. Por isso, horários que começam na próxima hora não aparecem.";

export const slotsQuerySchema = z
  .object({
    professionalUserId: z.string().uuid("Profissional inválido."),
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
  })
  .strict();

export const slotSchema = z
  .object({
    startsAt: z.string(),
    endsAt: z.string(),
    modality: modalitySchema,
    timezone: z.string(),
  })
  .strict();

export type Slot = z.infer<typeof slotSchema>;

export const weekStartSchema = isoDateSchema.refine((date) => isCivilDate(date) && civilWeekStart(date) === date, "A semana começa na segunda-feira.");
export const availabilityWeekQuerySchema = z.object({ weekStart: weekStartSchema, timezone: timezoneSchema }).strict();
export const weekIntervalSchema = z.object({
  date: isoDateSchema,
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
  slotMinutes: slotMinutesSchema,
  modality: modalitySchema,
}).strict().refine((value) => value.endMinute - value.startMinute >= value.slotMinutes, "O intervalo precisa caber ao menos um horário.");
export const weekBlockSchema = z.object({
  date: isoDateSchema,
  startMinute: z.number().int().min(0).max(1439).nullable(),
  endMinute: z.number().int().min(1).max(1440).nullable(),
}).strict().refine((value) =>
  value.startMinute === null ? value.endMinute === null : value.endMinute !== null && value.endMinute > value.startMinute,
"Informe início e fim válidos, ou bloqueie o dia inteiro.");
export type WeekInterval = z.infer<typeof weekIntervalSchema>;
export type WeekBlock = z.infer<typeof weekBlockSchema>;

export const availabilityWeekInputSchema = z.object({
  weekStart: weekStartSchema, timezone: timezoneSchema,
  revision: z.string().regex(/^[0-9a-f]{32}$/),
  intervals: z.array(weekIntervalSchema).max(28), blocks: z.array(weekBlockSchema).max(28),
}).strict().superRefine((value, ctx) => {
  const end = addCivilDays(value.weekStart, 6);
  if ([...value.intervals, ...value.blocks].some((item) => item.date < value.weekStart || item.date > end)) {
    ctx.addIssue({ code: "custom", message: "Todas as datas precisam pertencer à semana selecionada." });
  }
  for (let i = 0; i < value.intervals.length; i++) {
    const a = value.intervals[i]!;
    if (value.intervals.slice(i + 1).some((b) => a.date === b.date && a.startMinute < b.endMinute && b.startMinute < a.endMinute)) {
      ctx.addIssue({ code: "custom", message: "Dois intervalos se sobrepõem no mesmo dia." });
      break;
    }
  }
});
export type AvailabilityWeekInput = z.infer<typeof availabilityWeekInputSchema>;
export const availabilityWeekSchema = z.object({
  weekStart: weekStartSchema, timezone: timezoneSchema, published: z.boolean(), revision: z.string(),
  intervals: z.array(weekIntervalSchema), blocks: z.array(weekBlockSchema), slots: z.array(slotSchema),
  conflicts: z.array(z.object({ appointmentId: z.string().uuid(), startsAt: z.string(), endsAt: z.string(), status: z.enum(["requested", "confirmed"]) }).strict()),
}).strict();
export type AvailabilityWeek = z.infer<typeof availabilityWeekSchema>;
export const weekSlotsQuerySchema = z.object({ professionalUserId: z.string().uuid(), weekStart: weekStartSchema }).strict();
export const weekSlotsSchema = z.object({ timezone: timezoneSchema, slots: z.array(slotSchema) }).strict();
export type WeekSlots = z.infer<typeof weekSlotsSchema>;

export const appointmentRequestSchema = z
  .object({
    connectionId: z.string().uuid("Vínculo inválido."),
    startsAt: z.string().datetime({ offset: true, message: "Horário inválido." }),
    modality: modalitySchema,
    /** Gerada no cliente por intencao de pedido; o banco usa para deduplicar. */
    idempotencyKey: z.string().uuid("Pedido inválido."),
  })
  .strict();

export type AppointmentRequest = z.infer<typeof appointmentRequestSchema>;

export const CANCEL_REASONS = [
  "declined",
  "schedule_change",
  "unavailable",
  "relationship_ended",
  "other",
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number];

export const CANCEL_REASON_LABEL: Record<CancelReason, string> = {
  declined: "Pedido recusado",
  schedule_change: "Mudança de agenda",
  unavailable: "Indisponibilidade",
  relationship_ended: "Acompanhamento encerrado",
  other: "Outro motivo",
};

/** Vocabulario por papel, espelhando `cancel_appointment` no banco. */
export const CLIENT_CANCEL_REASONS = ["schedule_change", "other"] as const satisfies readonly CancelReason[];
export const PROFESSIONAL_CANCEL_REASONS = [
  "unavailable",
  "schedule_change",
  "other",
] as const satisfies readonly CancelReason[];

export const appointmentActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm") }).strict(),
  z
    .object({
      action: z.literal("cancel"),
      reason: z.enum(["declined", "schedule_change", "unavailable", "other"]),
    })
    .strict(),
  z
    .object({ action: z.literal("close"), outcome: z.enum(["completed", "no_show"]) })
    .strict(),
]);

export type AppointmentAction = z.infer<typeof appointmentActionSchema>;

export const APPOINTMENT_STATUSES = [
  "requested",
  "confirmed",
  "cancelled",
  "completed",
  "no_show",
] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  requested: "Aguardando confirmação",
  confirmed: "Confirmado",
  cancelled: "Cancelado",
  completed: "Realizado",
  no_show: "Não compareceu",
};

export const appointmentSchema = z
  .object({
    id: z.string().uuid(),
    connectionId: z.string().uuid(),
    role: z.enum(["client", "professional"]),
    counterpartUserId: z.string().uuid(),
    counterpartName: z.string().nullable(),
    startsAt: z.string(),
    endsAt: z.string(),
    timezone: z.string(),
    modality: modalitySchema,
    status: z.enum(APPOINTMENT_STATUSES),
    requestedAt: z.string(),
    confirmedAt: z.string().nullable(),
    cancelledAt: z.string().nullable(),
    cancelledByMe: z.boolean().nullable(),
    cancelReason: z.enum(CANCEL_REASONS).nullable(),
  })
  .strict();

export type Appointment = z.infer<typeof appointmentSchema>;

export const schedulingProfessionalSchema = z
  .object({
    connectionId: z.string().uuid(),
    professionalUserId: z.string().uuid(),
    professionalName: z.string().nullable(),
    hasAvailability: z.boolean(),
  })
  .strict();

export type SchedulingProfessional = z.infer<typeof schedulingProfessionalSchema>;

/**
 * Erros de regra devolvidos pelo banco, com a frase que a tela mostra.
 *
 * O codigo e estavel (vai no corpo da resposta); a frase nao revela nada da
 * agenda alheia: "horario indisponivel" vale para ocupado por outra pessoa,
 * pelo proprio pedido ou fora da grade.
 */
export const SCHEDULING_ERROR_MESSAGE = {
  verification_required: "Sua verificação profissional precisa estar vigente para usar a agenda.",
  invalid_timezone: "Fuso horário inválido. Escolha um fuso da lista.",
  invalid_rules: "Revise os intervalos: início, fim e duração precisam ser válidos.",
  overlapping_rules: "Dois intervalos se sobrepõem no mesmo dia.",
  invalid_range: "Período de busca inválido.",
  invalid_request: "Pedido inválido.",
  idempotency_mismatch: "Este pedido já foi enviado com outro horário. Recarregue a página.",
  relationship_not_found: "Vínculo não encontrado.",
  relationship_inactive: "O acompanhamento não está ativo, então não é possível marcar horário.",
  professional_unavailable: "Este profissional não está disponível para agenda no momento.",
  outside_window: "Escolha um horário entre 1 hora e 60 dias a partir de agora.",
  slot_not_offered: "Este horário não está na agenda do profissional.",
  slot_unavailable: "Este horário acabou de ficar indisponível. Escolha outro.",
  appointment_not_found: "Horário não encontrado.",
  invalid_transition: "Este horário já mudou de situação. Recarregue a página.",
  appointment_past: "Este horário já passou.",
  invalid_reason: "Motivo não permitido para esta ação.",
  invalid_outcome: "Resultado inválido.",
  appointment_not_started: "Só é possível registrar o resultado depois do início do horário.",
  invalid_exception: "Revise a exceção: datas, horários, duração e modalidade precisam ser válidos.",
  exception_outside_window: "Aberturas vão até 60 dias à frente e bloqueios até 1 ano. Datas passadas não entram.",
  exception_overlap: "Esta abertura se sobrepõe a outra abertura na mesma data.",
  too_many_exceptions: "Limite de 60 exceções futuras atingido. Remova alguma antes de criar outra.",
  exception_not_found: "Exceção não encontrada.",
  invalid_week: "Revise as datas, os intervalos e o limite de 60 dias da semana.",
  week_changed: "Esta semana foi alterada em outra tela. Recarregue a semana antes de editar.",
  past_availability_readonly: "Dias passados são somente leitura. Edite os dias de hoje em diante.",
  timezone_conflict: "Há disponibilidade futura em outro fuso. Mantenha o fuso dessas publicações.",
} as const;

export type SchedulingErrorCode = keyof typeof SCHEDULING_ERROR_MESSAGE;

export function isSchedulingErrorCode(value: unknown): value is SchedulingErrorCode {
  return typeof value === "string" && value in SCHEDULING_ERROR_MESSAGE;
}
