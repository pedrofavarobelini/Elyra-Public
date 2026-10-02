import { z } from "zod";



export const SESSION_KINDS = ["guided", "free", "deep_checkin"] as const;
export const sessionKindSchema = z.enum(SESSION_KINDS);
export type SessionKind = (typeof SESSION_KINDS)[number];

export const SESSION_KIND_LABEL: Record<SessionKind, string> = {
  guided: "Reflexão guiada",
  free: "Reflexão livre",
  deep_checkin: "Check-in aprofundado",
};

export const SESSION_KIND_DESCRIPTION: Record<SessionKind, string> = {
  guided: "Perguntas e orientações para explorar seus sentimentos.",
  free: "Espaço livre para falar sobre o que está pensando ou sentindo.",
  deep_checkin: "Avaliação completa do seu estado emocional atual.",
};

export const SESSION_KIND_DURATION: Record<SessionKind, string> = {
  guided: "30-40 min",
  free: "20-30 min",
  deep_checkin: "40-50 min",
};

/**
 * Recursos de captura. Cada um e uma permissao propria: ligar o microfone nao
 * liga a camera, e nenhum deles implica compartilhamento.
 */
export const CAPTURE_RESOURCES = ["screen", "camera", "microphone"] as const;
export type CaptureResource = (typeof CAPTURE_RESOURCES)[number];

export const CAPTURE_LABEL: Record<CaptureResource, string> = {
  screen: "Gravar/compartilhar tela",
  camera: "Usar câmera",
  microphone: "Usar microfone",
};


export const MEDIA_KIND_LABEL: Record<CaptureResource, string> = {
  screen: "Tela",
  camera: "Câmera",
  microphone: "Microfone",
};

/**
 * Configuracao de uma sessao.
 *
 * `shareResult`, `shareTranscript` e `shareRecording` sao **tres decisoes
 * distintas**. Autorizar o resultado nao autoriza a transcricao, e autorizar a
 * transcricao nao autoriza a midia original.
 */
export const sessionSetupSchema = z.object({
  kind: sessionKindSchema,
  screen: z.boolean(),
  camera: z.boolean(),
  microphone: z.boolean(),
  transcribe: z.boolean(),

  visualAnalysis: z.boolean(),
  keepRecording: z.boolean(),
  aiAnalysis: z.boolean(),
  shareResult: z.boolean(),
  shareTranscript: z.boolean(),
  shareRecording: z.boolean(),
  trainingEligible: z.boolean(),
});

export type SessionSetup = z.infer<typeof sessionSetupSchema>;

/**
 * Padrao da preparacao de sessao.
 *
 * **Toda permissao nasce `false`.** Habilitar o modulo de sessoes e uma coisa;
 * autorizar captura de tela, camera ou microfone e outra, decidida no preflight
 * de cada sessao. Um padrao ligado transformaria a ativacao da feature em
 * consentimento presumido para gravar a pessoa - exatamente o que o contrato de
 * privacidade da V1 proibe.
 *
 * O mesmo vale para o compartilhamento: resultado, transcricao e midia original
 * sao tres decisoes distintas e nenhuma delas e herdada da outra.
 */
export const DEFAULT_SESSION_SETUP: SessionSetup = {
  kind: "guided",
  screen: false,
  camera: false,
  microphone: false,
  transcribe: false,
  visualAnalysis: false,
  keepRecording: false,
  aiAnalysis: false,
  shareResult: false,
  shareTranscript: false,
  shareRecording: false,
  trainingEligible: false,
};

export const sessionCreateSchema = sessionSetupSchema.superRefine((setup, ctx) => {
  if (!hasAnyCapture(setup)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Autorize ao menos um recurso de captura.",
    });
  }
  if (setup.shareTranscript && !setup.transcribe) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shareTranscript"],
      message: "Compartilhar transcrição exige consentimento para transcrever.",
    });
  }
  if (setup.transcribe && !setup.microphone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["transcribe"],
      message: "Transcrição exige consentimento para microfone.",
    });
  }
  if (setup.visualAnalysis && !setup.camera) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["visualAnalysis"],
      message: "Análise visual exige consentimento para câmera.",
    });
  }
  if (setup.shareRecording && !setup.keepRecording) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["shareRecording"],
      message: "Compartilhar gravação exige consentimento para Storage.",
    });
  }
  if (setup.trainingEligible) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["trainingEligible"],
      message: "O aprendizado ainda não está autorizado para a Elyra.",
    });
  }
});

/**
 * Habilitar o modulo **nao** e conceder captura.
 *
 * `sessionsEnabled` governa a existencia da area de sessoes; `screen`, `camera`
 * e `microphone` sao permissoes de dispositivo escolhidas uma a uma no preflight.
 * As duas coisas nunca sao decididas pelo mesmo controle.
 */
export const CAPTURE_FIELDS = ["screen", "camera", "microphone"] as const;

/** `true` se alguma captura de dispositivo foi autorizada nesta sessao. */
export function hasAnyCapture(setup: SessionSetup): boolean {
  return CAPTURE_FIELDS.some((field) => setup[field]);
}

export const SESSION_STATUSES = [
  "preparing",
  "capturing",
  "paused",
  "completed",
  "cancelled",
  "cleanup_pending",
  "deleted",
  "error",
  "analyzed",
] as const;
export const sessionStatusSchema = z.enum(SESSION_STATUSES);
export type SessionStatus = z.infer<typeof sessionStatusSchema>;

export const SESSION_STATUS_LABEL: Record<SessionStatus, string> = {
  preparing: "Aguardando permissões",
  capturing: "Em andamento",
  paused: "Pausada",
  completed: "Captura concluída",
  cancelled: "Cancelada",
  cleanup_pending: "Exclusão pendente",
  deleted: "Excluída",
  error: "Falha de captura",
  analyzed: "Análise concluída",
};

export const multimodalSessionSchema = z.object({
  id: z.string().min(1),
  kind: sessionKindSchema,
  startedAt: z.string().datetime({ offset: true }),
  durationMinutes: z.number().int().min(0).nullable(),
  status: sessionStatusSchema,
  resources: z.array(z.enum(CAPTURE_RESOURCES)),
});

export type MultimodalSession = z.infer<typeof multimodalSessionSchema>;

export const SESSION_CAPTURE_STATES = [
  "supported",
  "unsupported",
  "permission_pending",
  "granted",
  "denied",
  "cancelled",
  "ended",
  "error",
] as const;
export const sessionCaptureStateSchema = z.enum(SESSION_CAPTURE_STATES);
export type SessionCaptureState = z.infer<typeof sessionCaptureStateSchema>;

export type CaptureStateMap = Record<CaptureResource, SessionCaptureState>;


export const MAX_MEDIA_BYTES = 32 * 1024 * 1024;

/** Duracao maxima de uma sessao, em ms. Espelha o `check` do banco. */
export const MAX_SESSION_MS = 3_600_000;

export const MEDIA_ASSET_STATUSES = [
  "uploading",
  "stored",
  "interrupted",
  "deleting",
] as const;
export const mediaAssetStatusSchema = z.enum(MEDIA_ASSET_STATUSES);

export const mediaAssetSchema = z.object({
  id: z.string().uuid(),
  sessionId: z.string().uuid(),
  mediaKind: z.enum(CAPTURE_RESOURCES),
  mimeType: z.enum([
    "video/webm",
    "video/mp4",
    "audio/webm",
    "audio/ogg",
    "audio/mp4",
  ]),
  sizeBytes: z.number().int().positive().max(MAX_MEDIA_BYTES),
  durationMs: z.number().int().min(0).max(3_600_000).nullable(),
  checksumSha256: z.string().regex(/^[0-9a-f]{64}$/),
  retentionUntil: z.string().datetime({ offset: true }),
  status: mediaAssetStatusSchema,
});
export type MediaAsset = z.infer<typeof mediaAssetSchema>;

export const multimodalSessionDetailSchema = z.object({
  id: z.string().uuid(),
  kind: sessionKindSchema,
  status: sessionStatusSchema.exclude(["analyzed"]),
  setup: sessionSetupSchema,
  startedAt: z.string().datetime({ offset: true }),
  endedAt: z.string().datetime({ offset: true }).nullable(),
  assets: z.array(mediaAssetSchema),
});
export type MultimodalSessionDetail = z.infer<
  typeof multimodalSessionDetailSchema
>;

export const sessionStatusUpdateSchema = z.object({
  status: z.enum(["capturing", "paused", "completed", "cancelled", "error"]),
});
