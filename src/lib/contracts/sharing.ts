import { z } from "zod";



export const SHAREABLE_CATEGORIES = [
  "mood",
  "anxiety",
  "sleep",
  "energy",
  "cycle",
  "sessions",
  "journal",
] as const;

export const shareableCategorySchema = z.enum(SHAREABLE_CATEGORIES);
export type ShareableCategory = (typeof SHAREABLE_CATEGORIES)[number];

export const CATEGORY_LABEL: Record<ShareableCategory, string> = {
  mood: "Humor",
  anxiety: "Ansiedade percebida",
  sleep: "Qualidade do sono",
  energy: "Energia",
  cycle: "Ciclo menstrual",
  sessions: "Sessões",
  journal: "Diário compartilhado",
};

export const CATEGORY_DESCRIPTION: Record<ShareableCategory, string> = {
  mood: "Seus registros de humor ao longo do tempo.",
  anxiety: "Sua ansiedade percebida, conforme você mesma relata.",
  sleep: "Duração e qualidade do sono que você registrou.",
  energy: "Seus registros de energia.",
  cycle: "Registros do ciclo, quando o acompanhamento estiver ativo.",
  sessions: "Resultados das suas sessões multimodais.",
  journal: "Suas anotações do diário, entrada por entrada.",
};

export type SharingState = Record<ShareableCategory, boolean>;

/**
 * Estado inicial do compartilhamento.
 *
 * A projecao visual tambem nasce integralmente desligada. A figura historica
 * nao pode conceder autorizacao real nem sugerir um opt-out.
 */
export const DEFAULT_SHARING: SharingState = {
  mood: false,
  anxiety: false,
  sleep: false,
  energy: false,
  cycle: false,
  sessions: false,
  journal: false,
};

export function sharedCategories(state: SharingState): ShareableCategory[] {
  return SHAREABLE_CATEGORIES.filter((c) => state[c]);
}

export const SHARING_SCOPES = [
  "emotional",
  "sleep",
  "goals",
  "journal_entry",
  "cycle",
  "reports",
  "multimodal_result",
  "multimodal_transcript",

  "multimodal_ai_interpretation",
  "multimodal_media",
] as const;

export const sharingScopeSchema = z.enum(SHARING_SCOPES);
export type SharingScope = (typeof SHARING_SCOPES)[number];


export const SHARING_SCOPE_LABEL: Record<SharingScope, string> = {
  emotional: "Emocional",
  sleep: "Sono",
  goals: "Metas",
  journal_entry: "Entrada do diário",
  cycle: "Ciclo",
  reports: "Relatórios",
  multimodal_result: "Resultado multimodal (cálculo)",
  multimodal_transcript: "Transcrição multimodal",
  multimodal_ai_interpretation: "Interpretação por IA da sessão",
  multimodal_media: "Mídia multimodal",
};

export const professionalProfileInputSchema = z
  .object({
    registrationNumber: z.string().trim().min(3).max(50),
    specialty: z.string().trim().min(2).max(80),
  })
  .strict();

export const professionalConnectionActionSchema = z
  .object({
    connectionId: z.string().uuid(),
    /**
     * `accept`/`decline`: pedido legado (profissional). `revoke`: encerra o
     * vinculo - vira `revoked` pelo titular e `ended` pelo profissional.
     * `pause`/`resume`: somente o titular (o banco recusa qualquer outro).
     */
    action: z.enum(["accept", "decline", "revoke", "pause", "resume"]),
  })
  .strict();


export const RELATIONSHIP_STATUSES = [
  "pending",
  "active",
  "paused",
  "revoked",
  "ended",
] as const;
export type RelationshipStatus = (typeof RELATIONSHIP_STATUSES)[number];

export const RELATIONSHIP_STATUS_LABEL: Record<RelationshipStatus, string> = {
  pending: "Aguardando aceite",
  active: "Ativo",
  paused: "Pausado por você",
  revoked: "Encerrado por você",
  ended: "Encerrado pelo profissional",
};

/**
 * Vigencia do grant: `validFrom` (inicio) e `validUntil` (= `expires_at`).
 * Terceira decisao do titular, separada de conceder e de recortar a janela.
 */
export const sharingGrantValidityInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    scope: sharingScopeSchema,
    journalEntryId: z.string().uuid().nullable().optional(),
    validFrom: z.string().datetime({ offset: true }).nullable(),
    validUntil: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    if ((input.scope === "journal_entry") !== Boolean(input.journalEntryId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Diário exige uma entrada individual.",
        path: ["journalEntryId"],
      });
    }
    if (
      input.validFrom &&
      input.validUntil &&
      Date.parse(input.validUntil) <= Date.parse(input.validFrom)
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O fim da vigência precisa ser depois do início.",
        path: ["validUntil"],
      });
    }
  });

export type SharingGrantValidityInput = z.infer<typeof sharingGrantValidityInputSchema>;

/**
 * Espelho de exibicao da regra do banco para um grant: concedido, nao
 * revogado, dentro da vigencia. Serve para contar e rotular - **nunca** para
 * autorizar; quem autoriza e `professional_access_allowed(_on)`.
 */
export function grantIsCurrent(
  grant: {
    status: string;
    revoked_at: string | null;
    expires_at: string | null;
    valid_from?: string | null;
  },
  now: number = Date.now(),
): boolean {
  if (grant.status !== "granted" || grant.revoked_at) return false;
  if (grant.valid_from && Date.parse(grant.valid_from) > now) return false;
  if (grant.expires_at && Date.parse(grant.expires_at) <= now) return false;
  return true;
}

/** Eventos da trilha do titular (`professional_access_log.event_type`). */
export const PROFESSIONAL_TRAIL_EVENT_LABEL: Record<string, string> = {
  resource_viewed: "Abriu",
  relationship_created: "Vínculo criado",
  relationship_paused: "Vínculo pausado",
  relationship_resumed: "Vínculo retomado",
  relationship_revoked: "Vínculo encerrado por você",
  relationship_ended: "Vínculo encerrado pelo profissional",
  grant_created: "Compartilhamento concedido",
  grant_changed: "Compartilhamento ajustado",
  grant_revoked: "Compartilhamento revogado",
};

export const sharingPermissionInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    scope: sharingScopeSchema,
    enabled: z.boolean(),
    journalEntryId: z.string().uuid().nullable().optional(),
    expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasEntry = Boolean(input.journalEntryId);
    if ((input.scope === "journal_entry") !== hasEntry) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Diário exige uma entrada individual.",
        path: ["journalEntryId"],
      });
    }
    if (
      input.enabled &&
      input.expiresAt &&
      Date.parse(input.expiresAt) <= Date.now()
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Expiracao precisa estar no futuro.",
        path: ["expiresAt"],
      });
    }
  });

/**
 * Janela de tempo **do dado** - diferente de `expiresAt`, que e a validade da
 * permissao.
 *
 * `expiresAt` responde "ate quando esta pessoa pode olhar". Isto responde "quais
 * dias ela pode olhar". Sao perguntas diferentes e a V1 so tinha a primeira:
 * conceder o emocional para uma conversa sobre os ultimos tres meses entregava
 * tambem os tres anos anteriores.
 *
 * `null` em qualquer lado e "sem limite daquele lado" - preserva exatamente o
 * comportamento de toda permissao ja concedida. O recorte de verdade acontece no
 * PostgreSQL (`professional_access_allowed_on`); este schema so impede pedido
 * malformado antes de chegar la.
 */
export const sharingDataWindowInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    scope: sharingScopeSchema,
    journalEntryId: z.string().uuid().nullable().optional(),
    dataFrom: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inicial inválida.")
      .nullable(),
    dataTo: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Data final inválida.")
      .nullable(),
  })
  .strict()
  .superRefine((input, context) => {
    const hasEntry = Boolean(input.journalEntryId);
    if ((input.scope === "journal_entry") !== hasEntry) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Diário exige uma entrada individual.",
        path: ["journalEntryId"],
      });
    }
    if (input.dataFrom && input.dataTo && input.dataTo < input.dataFrom) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A data final não pode ser anterior à inicial.",
        path: ["dataTo"],
      });
    }
  });

export type SharingDataWindowInput = z.infer<typeof sharingDataWindowInputSchema>;

/**
 * Descreve a janela para quem esta lendo a tela.
 *
 * A frase precisa dizer o que a pessoa **esta concedendo**, e nao o que ela esta
 * restringindo: "todo o historico" e uma escolha, nao um default silencioso.
 */
export function describeDataWindow(
  dataFrom: string | null,
  dataTo: string | null,
): string {
  const br = (iso: string) => iso.split("-").reverse().join("/");
  if (!dataFrom && !dataTo) return "Todo o histórico.";
  if (dataFrom && dataTo) return `Registros de ${br(dataFrom)} a ${br(dataTo)}.`;
  if (dataFrom) return `Registros a partir de ${br(dataFrom)}.`;
  return `Registros até ${br(dataTo as string)}.`;
}

export const professionalNoteInputSchema = z
  .object({
    connectionId: z.string().uuid(),
    clientUserId: z.string().uuid(),
    body: z.string().trim().min(1).max(4000),
  })
  .strict();

export const professionalNoteUpdateSchema = z
  .object({ id: z.string().uuid(), body: z.string().trim().min(1).max(4000) })
  .strict();

export type ProfessionalProfileInput = z.infer<
  typeof professionalProfileInputSchema
>;
export type SharingPermissionInput = z.infer<
  typeof sharingPermissionInputSchema
>;
