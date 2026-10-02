import type { ObservableSignalName } from "@/lib/contracts/multimodal-signals";
import {
  computeMovementFrequency,
  computePauseSignals,
  computeVocalVariation,
} from "@/lib/multimodal-signals";
import {
  computeVisualSignals,
  sliceVisualSamples,
  type VisualObservationSample,
} from "@/lib/visual-signals";




export const SIGNAL_WINDOW_MS = 60_000;

/**
 * Minimo de janelas para a serie existir.
 *
 * Com uma janela so, a "serie temporal" e o agregado da sessao com outro nome -
 * e apresentar isso como leitura ao longo do tempo afirmaria variacao que
 * ninguem observou.
 */
export const MIN_WINDOWS_FOR_TIMELINE = 2;


export const WINDOWED_SIGNAL_NAMES = [
  "pause_count",
  "pause_total_duration",
  "pause_mean_duration",
  "vocal_variation",
  "movement_frequency",
  /*
    Os cinco visuais tem janela pelo mesmo motivo que os de audio tem: a mesma
    funcao que produz o agregado da sessao e aplicada a um recorte dela. Nenhum
    motor novo, nenhuma segunda verdade sobre a mesma sessao.

    E aqui a janela vale mais do que no audio. O agregado de uma sessao inteira
    dilui exatamente o que o roteiro de validacao procura: se a pessoa gesticulou
    muito por um minuto e ficou parada por outros vinte, a media nao distingue
    isso de vinte e um minutos de movimento moderado.
  */
  "head_movement_frequency",
  "head_motion_amplitude",
  "body_movement_frequency",
  "body_motion_amplitude",
  "hand_movement_frequency",
] as const;

export type WindowedSignalName = (typeof WINDOWED_SIGNAL_NAMES)[number];

export interface SignalWindow {
  signal: WindowedSignalName;
  /** Inicio da janela, em ms desde o inicio da sessao. */
  startOffsetMs: number;
  /** Fim da janela, exclusivo, em ms desde o inicio da sessao. */
  endOffsetMs: number;
  value: number;
}

export interface TimelineInput {
  durationMs: number;
  capturedResources: readonly ("screen" | "camera" | "microphone")[];
  audioEnvelope: readonly number[];
  audioFrameMs: number;
  frameDifferences: readonly number[];
  frameIntervalMs: number;
  /** A analise visual foi autorizada e rodou. */
  visualAnalysis?: boolean;
  /** Amostras visuais ja minimizadas, com offset proprio. */
  visualSamples?: readonly VisualObservationSample[];
  /**
   * PRO-7R: captura durante chamada. Silencio ali inclui o tempo em que a
   * pessoa ESCUTA o outro lado, entao pausa nao e medida (nem por janela).
   */
  excludePauses?: boolean;
}

/**
 * Recorta um vetor amostrado a intervalo fixo por um intervalo de tempo.
 *
 * O vetor nao carrega tempo: ele carrega **ordem**, e o intervalo entre amostras
 * e o que a converte em tempo. Por isso o recorte e por indice derivado, e nao
 * por busca - qualquer outra coisa inventaria precisao que a amostragem nao tem.
 */
function sliceByTime(
  samples: readonly number[],
  sampleIntervalMs: number,
  startMs: number,
  endMs: number,
): number[] {
  if (sampleIntervalMs <= 0) return [];
  const from = Math.max(0, Math.floor(startMs / sampleIntervalMs));
  const to = Math.min(samples.length, Math.ceil(endMs / sampleIntervalMs));
  return from >= to ? [] : samples.slice(from, to);
}


export function buildSignalWindows(input: TimelineInput): SignalWindow[] {
  const windowCount = Math.floor(input.durationMs / SIGNAL_WINDOW_MS);
  if (windowCount < MIN_WINDOWS_FOR_TIMELINE) return [];

  const captured = new Set(input.capturedResources);
  const hasMicrophone = captured.has("microphone");
  const hasCamera = captured.has("camera");
  const windows: SignalWindow[] = [];

  for (let index = 0; index < windowCount; index += 1) {
    const startOffsetMs = index * SIGNAL_WINDOW_MS;
    const endOffsetMs = startOffsetMs + SIGNAL_WINDOW_MS;

    if (hasMicrophone) {
      const envelope = sliceByTime(
        input.audioEnvelope,
        input.audioFrameMs,
        startOffsetMs,
        endOffsetMs,
      );
      if (envelope.length > 0) {
        // Mesmas funcoes do agregado da sessao, aplicadas ao recorte.
        if (!input.excludePauses) {
          const pauses = computePauseSignals(envelope, input.audioFrameMs);
          push(windows, "pause_count", startOffsetMs, endOffsetMs, pauses.pauseCount);
          push(
            windows,
            "pause_total_duration",
            startOffsetMs,
            endOffsetMs,
            pauses.pauseTotalMs,
          );
          push(
            windows,
            "pause_mean_duration",
            startOffsetMs,
            endOffsetMs,
            pauses.pauseMeanMs,
          );
        }
        const variation = computeVocalVariation(envelope);
        if (variation !== null) {
          push(windows, "vocal_variation", startOffsetMs, endOffsetMs, variation);
        }
      }
    }

    if (hasCamera) {
      const frames = sliceByTime(
        input.frameDifferences,
        input.frameIntervalMs,
        startOffsetMs,
        endOffsetMs,
      );
      const movement = computeMovementFrequency(frames);
      if (movement !== null) {
        push(windows, "movement_frequency", startOffsetMs, endOffsetMs, movement);
      }
    }

    if (hasCamera && input.visualAnalysis === true) {
      /*
        Recorte por `atMs`, e nao por indice: a amostragem visual e adaptativa,
        entao o intervalo entre amostras varia dentro da mesma sessao. Derivar
        tempo de indice deslocaria as janelas exatamente nas sessoes em que o
        aparelho engasgou - que sao as que mais precisam ser lidas com cuidado.
      */
      const slice = sliceVisualSamples(
        input.visualSamples ?? [],
        startOffsetMs,
        endOffsetMs,
      );
      const visual = computeVisualSignals(slice);
      for (const [name, value] of Object.entries(visual)) {
        if (value === null) continue;
        push(
          windows,
          name as WindowedSignalName,
          startOffsetMs,
          endOffsetMs,
          value,
        );
      }
    }
  }

  return windows;
}

function push(
  windows: SignalWindow[],
  signal: WindowedSignalName,
  startOffsetMs: number,
  endOffsetMs: number,
  value: number,
) {
  windows.push({ signal, startOffsetMs, endOffsetMs, value });
}

export const WINDOWED_SIGNALS: ReadonlySet<ObservableSignalName> = new Set(
  WINDOWED_SIGNAL_NAMES,
);
