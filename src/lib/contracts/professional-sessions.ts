import { z } from "zod";



export const SESSION_CONSENTS = [
  "allow_audio",
  "allow_video",
  "allow_transcription",
  "allow_ai_derivation",
  "allow_professional_transcript_access",
] as const;
export const sessionConsentSchema = z.enum(SESSION_CONSENTS);
export type SessionConsent = z.infer<typeof sessionConsentSchema>;

export const SESSION_CONSENT_COPY: Record<
  SessionConsent,
  {
    label: string;
    on: string;
    off: string;
    /** Mesma permissao, lida pelo profissional (terceira pessoa). */
    proOn: string;
    proOff: string;
    requires?: SessionConsent;
  }
> = {
  allow_audio: {
    label: "Microfone",
    on: "Você pode registrar áudio seu nesta sessão.",
    off: "Nenhum áudio seu é registrado nesta sessão.",
    proOn: "A pessoa pode registrar áudio dela nesta sessão.",
    proOff: "A pessoa não registra áudio nesta sessão.",
  },
  allow_video: {
    label: "Câmera",
    on: "Você pode registrar vídeo seu nesta sessão.",
    off: "Nenhum vídeo seu é registrado nesta sessão.",
    proOn: "A pessoa pode registrar vídeo dela nesta sessão.",
    proOff: "A pessoa não registra vídeo nesta sessão.",
  },
  allow_transcription: {
    label: "Transcrição",
    on: "O áudio que você registrar pode virar texto, no seu aparelho.",
    off: "Nada do que você disser vira texto.",
    proOn: "O áudio que a pessoa registrar pode virar texto, no aparelho dela.",
    proOff: "Nada do que a pessoa disser vira texto.",
    requires: "allow_audio",
  },
  allow_ai_derivation: {
    label: "Análise por IA",
    on: "O que você registrar pode gerar sinais e leitura por IA para você.",
    off: "Nenhuma análise por IA é feita sobre esta sessão.",
    proOn: "A pessoa permitiu análise por IA para ela mesma. Isso não libera nada para você.",
    proOff: "Nenhuma análise por IA é feita sobre esta sessão.",
  },
  allow_professional_transcript_access: {
    label: "Profissional lê a transcrição",
    on: "O profissional pode ler a transcrição desta sessão. Cada leitura fica registrada para você.",
    off: "O profissional não lê a transcrição desta sessão.",
    proOn: "Você pode ler a transcrição desta sessão. Cada leitura fica registrada para a pessoa.",
    proOff: "Você não lê a transcrição desta sessão.",
    requires: "allow_transcription",
  },
};

export const sessionConsentUpdateSchema = z
  .object({ consent: sessionConsentSchema, value: z.boolean() })
  .strict();

export const PROFESSIONAL_SESSION_STATUSES = [
  "scheduled",
  "ready",
  "active",
  "completed",
  "cancelled",
  "expired",
] as const;
export type ProfessionalSessionStatus = (typeof PROFESSIONAL_SESSION_STATUSES)[number];

export const PROFESSIONAL_SESSION_STATUS_LABEL: Record<ProfessionalSessionStatus, string> = {
  scheduled: "Agendada",
  ready: "Aberta para entrada",
  active: "Em andamento",
  completed: "Concluída",
  cancelled: "Cancelada",
  expired: "Não aconteceu",
};

export const professionalSessionSummarySchema = z
  .object({
    id: z.string().uuid(),
    appointmentId: z.string().uuid(),
    role: z.enum(["client", "professional"]),
    counterpartName: z.string().nullable(),
    startsAt: z.string(),
    endsAt: z.string(),
    timezone: z.string(),
    modality: z.enum(["online", "in_person"]),
    opensAt: z.string(),
    closesAt: z.string(),
    status: z.enum(PROFESSIONAL_SESSION_STATUSES),
  })
  .strict();
export type ProfessionalSessionSummary = z.infer<typeof professionalSessionSummarySchema>;

export const professionalSessionDetailSchema = professionalSessionSummarySchema
  .extend({
    consents: z
      .object({
        allow_audio: z.boolean(),
        allow_video: z.boolean(),
        allow_transcription: z.boolean(),
        allow_ai_derivation: z.boolean(),
        allow_professional_transcript_access: z.boolean(),
      })
      .strict(),
    mePresent: z.boolean(),
    meEnteredCount: z.number().int(),
    otherPresent: z.boolean(),
    otherEnteredCount: z.number().int(),
    captureCount: z.number().int(),
    transcriptAvailable: z.boolean(),
  })
  .strict();
export type ProfessionalSessionDetail = z.infer<typeof professionalSessionDetailSchema>;

export const sessionActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enter") }).strict(),
  z.object({ action: z.literal("leave") }).strict(),
  z.object({ action: z.literal("complete") }).strict(),
]);
export type SessionAction = z.infer<typeof sessionActionSchema>;

export const SESSION_ENTRY_OUTCOMES = ["entered", "credential_invalid", "session_closed", "not_found"] as const;
export type SessionEntryOutcome = (typeof SESSION_ENTRY_OUTCOMES)[number];

export const SESSION_ERROR_MESSAGE = {
  session_not_found: "Sessão não encontrada.",
  session_closed: "A entrada desta sessão não está aberta agora.",
  verification_required: "Sua verificação profissional precisa estar vigente para entrar.",
  relationship_inactive: "O acompanhamento não está ativo, então a sessão não abre.",
  rate_limited: "Muitas tentativas de entrada seguidas. Aguarde alguns minutos.",
  invalid_transition: "Esta sessão já mudou de situação. Recarregue a página.",
  invalid_consent: "Permissão inválida.",
  consent_dependency: "Ligue primeiro a permissão da qual esta depende.",
  credential_invalid: "A entrada não foi confirmada. Tente entrar de novo.",
  not_found: "Sessão não encontrada.",
} as const;
export type SessionErrorCode = keyof typeof SESSION_ERROR_MESSAGE;

export function isSessionErrorCode(value: unknown): value is SessionErrorCode {
  return typeof value === "string" && value in SESSION_ERROR_MESSAGE;
}

/** O que depende de quem: desligar uma permissao derruba as que dependem dela. */
export function dependentsOf(consent: SessionConsent): SessionConsent[] {
  return SESSION_CONSENTS.filter((item) => SESSION_CONSENT_COPY[item].requires === consent).flatMap(
    (item) => [item, ...dependentsOf(item)],
  );
}

// ---------------------------------------------------------------------------
// PRO-7R — chamada em tempo real (ADR-0025)
// ---------------------------------------------------------------------------

export const sessionMediaRequestSchema = z
  .object({ purpose: z.enum(["join", "heartbeat"]) })
  .strict();

export const SESSION_MEDIA_EVENTS = ["joined", "left", "reconnected"] as const;
export const sessionMediaEventSchema = z.object({ event: z.enum(SESSION_MEDIA_EVENTS) }).strict();
export type SessionMediaEvent = (typeof SESSION_MEDIA_EVENTS)[number];

export const SESSION_MEDIA_DENIALS = [
  "not_present",
  "session_closed",
  "relationship_inactive",
  "verification_required",
] as const;
export type SessionMediaDenial = (typeof SESSION_MEDIA_DENIALS)[number];

/** Recusa em texto; a mesma frase para os dois papeis, sem detalhe sensivel. */
export const SESSION_MEDIA_DENIAL_COPY: Record<SessionMediaDenial, string> = {
  not_present: "Entre na sessão para começar a chamada.",
  session_closed: "A sessão não está aberta, então a chamada foi encerrada.",
  relationship_inactive: "O acompanhamento não está ativo, então a chamada foi encerrada.",
  verification_required: "A verificação do profissional não está vigente, então a chamada foi encerrada.",
};

export const REALTIME_UNAVAILABLE_COPY = "Não foi possível iniciar a chamada.";

/**
 * Resposta da autorizacao de midia. `token` e `e2eeKey` so existem no `join`
 * autorizado e nunca sao guardados pelo cliente fora da memoria da chamada.
 */
export type SessionMediaGrant =
  | {
      status: "authorized";
      generation: number;
      heartbeatSeconds: number;
      join: null | {
        url: string;
        token: string;
        e2eeKey: string;
        identity: string;
        peerIdentity: string;
      };
    }
  | { status: "denied"; reason: SessionMediaDenial; message: string };
