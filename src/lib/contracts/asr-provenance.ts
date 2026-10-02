import { z } from "zod";



/** Vocabulario fechado de motores. Um motor novo exige migration e ADR. */
export const ASR_ENGINES = [
  /** Reconhecedor nativo do navegador, provado local antes do uso. */
  "native_speech_recognition",
  /** Whisper carregado e executado pela propria Elyra, no aparelho. */
  "local_whisper",

  "on_device_speech_api",
] as const;
export type AsrEngine = (typeof ASR_ENGINES)[number];

export const ASR_ENGINE_LABEL: Record<AsrEngine, string> = {
  native_speech_recognition: "Transcrição automática do navegador",
  local_whisper: "Transcrição automática local",
  on_device_speech_api: "Transcrição automática no aparelho",
};

/**
 * O suficiente para reproduzir a execucao, e nada alem disso.
 *
 * Os campos de detalhe sao `null` para o motor nativo por um motivo factual, e
 * nao por omissao: o navegador nao publica qual modelo usou, com que
 * quantizacao, nem em que versao de runtime. Preencher isso com um palpite
 * seria fabricar proveniencia — e proveniencia fabricada e pior que ausente.
 */
export const asrProvenanceSchema = z
  .object({
    engine: z.enum(ASR_ENGINES),
    model: z.string().min(1).max(120).nullable(),
    quantization: z.string().min(1).max(40).nullable(),
    runtime: z.string().min(1).max(60).nullable(),
    runtimeVersion: z.string().min(1).max(40).nullable(),
    vad: z.string().min(1).max(60).nullable(),
  })
  .strict()
  .superRefine((provenance, ctx) => {
    const detail = [
      provenance.model,
      provenance.quantization,
      provenance.runtime,
      provenance.runtimeVersion,
      provenance.vad,
    ];
    if (provenance.engine === "local_whisper") {
      // Whisper local sem detalhe nao e reproduzivel, e reproduzir e a unica
      // razao de este contrato existir.
      if (detail.some((value) => value === null)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Whisper local exige proveniencia completa e reproduzivel.",
        });
      }
      return;
    }
    // O navegador nao expoe modelo nem runtime: declarar um seria inventa-lo.
    if (detail.some((value) => value !== null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Motor sem detalhe publicavel nao pode declarar detalhe.",
      });
    }
  });

export type AsrProvenance = z.infer<typeof asrProvenanceSchema>;

export const NATIVE_ASR_PROVENANCE: AsrProvenance = {
  engine: "native_speech_recognition",
  model: null,
  quantization: null,
  runtime: null,
  runtimeVersion: null,
  vad: null,
};

/**
 * Rotulo curto para a pessoa usuaria.
 *
 * Diz **como** o texto foi produzido, e nunca **quao bem**. "Transcrição
 * automática local" e uma afirmacao verificavel sobre o caminho; "transcrição
 * confiável" seria uma afirmacao sobre o conteudo, que este dado nao sustenta.
 */
export function asrProvenanceLabel(provenance: AsrProvenance | null): string {
  if (!provenance) return "Origem da transcrição não registrada";
  return ASR_ENGINE_LABEL[provenance.engine];
}
