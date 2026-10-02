import type { TranscriptUnavailableReason } from "@/lib/contracts/session-analysis";

/**
 * Contratos do reconhecimento de fala — a fronteira que o `capture-view` enxerga.
 *
 * ## Por que uma interface, e nao um `if`
 *
 * Existem dois caminhos com naturezas muito diferentes: o reconhecedor nativo do
 * navegador, que so pode ser usado quando o processamento local esta **provado**,
 * e um modelo local que a Elyra carrega e executa. Quem captura a sessao nao tem
 * por que saber de Whisper, de ONNX ou de VAD - e se souber, a proxima mudanca de
 * motor espalha por toda a tela de captura.
 *
 * ## A regra que atravessa os dois
 *
 * ```
 * RMS OBSERVES ENERGY.
 * VAD DECIDES WHETHER SPEECH IS PRESENT.
 * ASR TRANSCRIBES CANDIDATE SPEECH.
 * ELYRA ACCEPTS OR REJECTS THE SEGMENT.
 * VELTRIX INTERPRETS ONLY ACCEPTED DATA.
 * ```
 *
 * E, quando as camadas discordarem: **`ABSENCE > FABRICATION`**.
 */

/** Estado do reconhecimento, para a tela poder dizer a verdade durante a sessao. */
export const SPEECH_ENGINE_STATES = [
  /** Nativo provado local, ou modelo local pronto. */
  "active",
  /** O modelo local existe no aparelho e ainda esta carregando. */
  "loading",
  /** O modelo local precisa ser baixado, e ninguem baixou ainda. */
  "download_required",
  /** Baixando, a pedido explicito. */
  "downloading",
  /** Nao ha caminho local disponivel. A sessao segue sem transcricao. */
  "unavailable",
  /** Havia caminho, e ele quebrou. A sessao segue sem transcricao. */
  "failed",
] as const;
export type SpeechEngineState = (typeof SPEECH_ENGINE_STATES)[number];

/**
 * Rotulo de tela.
 *
 * Nenhum deles diz "IA ouvindo voce": o que existe aqui e reconhecimento
 * deterministico rodando no aparelho, e chamar isso de IA misturaria o
 * transcritor com o Veltrix, que sao coisas diferentes e tem consentimentos
 * diferentes.
 */
export const SPEECH_ENGINE_STATE_LABEL: Record<SpeechEngineState, string> = {
  active: "Transcrição no aparelho ativa",
  loading: "Carregando reconhecimento no aparelho",
  download_required: "Transcrição no aparelho precisa ser baixada",
  downloading: "Baixando reconhecimento no aparelho",
  unavailable: "Transcrição no aparelho indisponível",
  failed: "Transcrição no aparelho falhou",
};

/**
 * Um trecho candidato, ja recortado pelo VAD.
 *
 * "Candidato" e a palavra certa: o VAD disse que ha fala **aqui**, e ainda nao se
 * sabe o que foi dito, nem se o que o ASR devolver sera aproveitavel.
 */
export interface SpeechCandidate {
  /** Inicio do trecho, em ms desde o comeco da sessao. */
  startOffsetMs: number;
  /** Fim do trecho, em ms desde o comeco da sessao. */
  endOffsetMs: number;
  /** PCM mono 16 kHz do trecho. Vive em memoria e nao e persistido. */
  pcm: Float32Array;
  /** Maior probabilidade de fala observada pelo VAD dentro do trecho. */
  speechProbability: number;
}

/** Um trecho ja transcrito e **aceito**. */
export interface AcceptedSegment {
  text: string;
  startOffsetMs: number;
  endOffsetMs: number;
  wordCount: number;
}

/**
 * Por que um trecho foi recusado.
 *
 * Recusa e informacao, e nao ausencia de resultado: saber que o modelo devolveu
 * so uma tag de nao-fala e diferente de saber que ele nao devolveu nada.
 */
export const SEGMENT_REJECTIONS = [
  /** O VAD nao viu fala. O ASR nem chegou a rodar. */
  "vad_rejected",
  /** O ASR devolveu texto vazio. */
  "empty_text",

  "non_speech_only",
  /** O proprio modelo declarou ausencia de fala no trecho. */
  "no_speech_probability",
] as const;
export type SegmentRejection = (typeof SEGMENT_REJECTIONS)[number];

export interface RejectedSegment {
  startOffsetMs: number;
  endOffsetMs: number;
  rejection: SegmentRejection;
  /**
   * O texto recusado, **para diagnostico local apenas**.
   *
   * Nunca sobe para o servidor, nunca entra em `speech_rate`, nunca chega ao
   * Veltrix e nunca aparece no relatorio profissional. Existe para que uma
   * fabricacao possa ser vista num teste em vez de sumir sem rastro.
   */
  discardedText?: string;
}

export interface SpeechTranscription {
  accepted: AcceptedSegment[];
  rejected: RejectedSegment[];
}

/**
 * O motor de reconhecimento, visto de fora.
 *
 * `stop()` devolve o que foi reconhecido **e aceito**. Um motor que falhou
 * devolve ausencia com motivo tipado, e nunca lanca: falha de ASR nao pode
 * custar a sessao.
 */
export interface LocalSpeechEngine {
  readonly kind: "native" | "local_model";
  state(): SpeechEngineState;
  stop(): Promise<SpeechEngineResult>;
}

export type SpeechEngineResult =
  | { status: "available"; transcription: SpeechTranscription }
  | { status: "unavailable" | "failed"; reason: TranscriptUnavailableReason };
