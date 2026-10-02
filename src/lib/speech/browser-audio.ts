import {
  startPcmCollection,
  type AudioCaptureEnvironment,
  type PcmCollector,
} from "@/lib/speech/audio-pipeline";
import {
  joinAccepted,
  acceptedWordCount,
} from "@/lib/speech/segment-acceptance";
import type { SpeechTranscription } from "@/lib/speech/types";
import type { TranscriptCapture } from "@/lib/multimodal-derivation";

/**
 * Captura de PCM no navegador, e a ponte para o contrato de transcricao.
 *
 * ## Por que `ScriptProcessorNode`
 *
 * Um `AudioWorklet` seria o caminho moderno e exige um arquivo de worklet
 * servido a parte, com o `AudioWorkletProcessor` num modulo proprio. Para o que
 * esta capability faz — copiar blocos de PCM para memoria — o processador legado
 * entrega o mesmo resultado sem acrescentar um segundo ativo ao provisionamento,
 * que ja carrega 144 MB de modelo e kernels.
 *
 * A limitacao conhecida: ele roda na thread principal. O custo por bloco e uma
 * copia de array; o gasto real desta capability esta na inferencia, que roda
 * depois da sessao e nao durante. Se a medicao fisica mostrar travamento na
 * captura, a resposta e migrar para worklet — e nao supor agora que precisa.
 */

interface AudioContextLike {
  sampleRate: number;
  createMediaStreamSource(stream: MediaStream): {
    connect(destination: unknown): void;
    disconnect(): void;
  };
  createScriptProcessor(
    bufferSize: number,
    inputChannels: number,
    outputChannels: number,
  ): {
    onaudioprocess: ((event: { inputBuffer: { numberOfChannels: number; getChannelData(channel: number): Float32Array } }) => void) | null;
    connect(destination: unknown): void;
    disconnect(): void;
  };
  destination: unknown;
  close(): Promise<void> | void;
}

/** Bloco de 4096 amostras: ~85 ms a 48 kHz. Poucos eventos, sem estourar latencia. */
const PROCESSOR_BUFFER = 4096;

/**
 * Comeca a coletar PCM da stream do microfone.
 *
 * **Nunca lanca.** Ambiente sem `AudioContext` devolve um coletor que entrega
 * zero amostras, e o motor trata isso como ausencia — nao como falha de sessao.
 */
export function startBrowserPcmCollection(stream: MediaStream): PcmCollector {
  /*
    Guarda **antes** da API nativa, e nao um `try/catch` em volta dela.

    `createMediaStreamSource` recebendo algo que nao e um `MediaStream` de
    verdade pode derrubar o processo de renderizacao - e um `catch` nao pega
    crash de renderer. Foi assim que o E2E morreu com "Target crashed": a stream
    sintetica dos mocks nao e um `MediaStream`.

    Vale alem do teste: uma stream sem faixa de audio viva tambem nao tem o que
    coletar, e pedir isso ao navegador so cria caminho para falhar.
  */
  const usable =
    typeof MediaStream !== "undefined" &&
    stream instanceof MediaStream &&
    typeof stream.getAudioTracks === "function" &&
    stream.getAudioTracks().length > 0;

  if (!usable) {
    return { available: false, stop: () => new Float32Array(0), sampleCount: () => 0 };
  }

  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext);

  if (!Ctor) {
    return { available: false, stop: () => new Float32Array(0), sampleCount: () => 0 };
  }

  let context: AudioContextLike;
  try {
    context = new Ctor() as unknown as AudioContextLike;
  } catch {
    return { available: false, stop: () => new Float32Array(0), sampleCount: () => 0 };
  }

  const environment: AudioCaptureEnvironment = {
    sampleRate: context.sampleRate,
    createProcessor(onBlock) {
      try {
        const source = context.createMediaStreamSource(stream);
        const processor = context.createScriptProcessor(PROCESSOR_BUFFER, 1, 1);

        processor.onaudioprocess = (event) => {
          const input = event.inputBuffer;
          const channels: Float32Array[] = [];
          for (let i = 0; i < input.numberOfChannels; i += 1) {
            channels.push(input.getChannelData(i));
          }
          onBlock(channels);
        };

        source.connect(processor as unknown as AudioNode);
        // Ligar ao destino mantem o grafo ativo; o processador nao emite som.
        processor.connect(context.destination);

        return {
          disconnect() {
            processor.onaudioprocess = null;
            processor.disconnect();
            source.disconnect();
            void Promise.resolve(context.close()).catch(() => undefined);
          },
        };
      } catch {
        return null;
      }
    },
  };

  return startPcmCollection(environment);
}

/**
 * Converte a transcricao **aceita** no contrato que a submissao ja entende.
 *
 * So os trechos aceitos atravessam. `RejectedSegment.discardedText` fica de fora
 * por construcao: ele existe para diagnostico local, e nao ha caminho daqui que
 * o coloque num payload.
 */
export function toTranscriptCapture(
  transcription: SpeechTranscription,
  maxChars: number,
): TranscriptCapture {
  const text = joinAccepted(transcription);
  if (text === "" || acceptedWordCount(transcription) === 0) {
    /*
      Nenhum trecho aceito. `no_speech_detected` e a resposta certa **aqui**, e a
      camada de cima ainda pode troca-la por `speech_detected_but_not_transcribed`
      se a envoltoria RMS tiver medido voz - a contradicao entre sensores que a
      validacao fisica #1 obrigou a nomear.
    */
    return { status: "unavailable", reason: "no_speech_detected" };
  }

  return {
    status: "available",
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars,
    segments: transcription.accepted.map((segment) => ({
      text: segment.text,
      startOffsetMs: segment.startOffsetMs,
      endOffsetMs: segment.endOffsetMs,
    })),
  };
}
