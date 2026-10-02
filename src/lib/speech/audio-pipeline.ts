/**
 * Preparo do audio para o ASR — PCM mono a 16 kHz, em memoria.
 *
 * ## Por que nao reaproveitar o `MediaRecorder`
 *
 * A gravacao do `MediaRecorder` sai comprimida (WebM/Opus) e existe **somente**
 * quando `keepRecording` esta ligado. Usar ela como entrada do ASR amarraria
 * transcricao a retencao - duas decisoes que a Elyra mantem separadas de
 * proposito - e ainda exigiria decodificar o container para voltar a PCM.
 *
 * A transcricao le a stream diretamente, e o audio vive **so em memoria**. Com
 * `keepRecording = false` a transcricao continua funcionando e nenhum byte de
 * midia e persistido.
 *
 * ## Por que 16 kHz mono
 *
 * E a taxa que o Whisper e o Silero esperam. Entregar 48 kHz estereo obrigaria
 * os dois a reamostrar internamente, gastando o dobro de memoria no caminho.
 */

export const ASR_SAMPLE_RATE = 16_000;

/**
 * Mistura canais para mono somando e dividindo.
 *
 * Media, e nao "pega o canal esquerdo": num microfone estereo a voz pode estar
 * mais forte num dos lados, e descartar metade jogaria fora sinal util.
 */
export function toMono(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 0) return new Float32Array(0);
  const first = channels[0]!;
  if (channels.length === 1) return first;

  const out = new Float32Array(first.length);
  for (let i = 0; i < first.length; i += 1) {
    let sum = 0;
    for (const channel of channels) sum += channel[i] ?? 0;
    out[i] = sum / channels.length;
  }
  return out;
}

/**
 * Reamostra por interpolacao linear.
 *
 * Linear, e nao sinc: a diferenca de qualidade e inaudivel para reconhecimento
 * de fala, e um filtro polifasico custaria CPU no mesmo aparelho modesto que
 * precisa rodar o Whisper depois. Trocar precisao que ninguem consome por tempo
 * que falta seria a troca errada.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number = ASR_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  if (fromRate <= 0 || toRate <= 0) return new Float32Array(0);

  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);

  for (let i = 0; i < length; i += 1) {
    const position = i * ratio;
    const index = Math.floor(position);
    const fraction = position - index;
    const a = input[index] ?? 0;
    const b = input[index + 1] ?? a;
    out[i] = a + (b - a) * fraction;
  }
  return out;
}

/** Concatena blocos de PCM preservando a ordem de chegada. */
export function concatPcm(blocks: readonly Float32Array[]): Float32Array {
  const total = blocks.reduce((sum, block) => sum + block.length, 0);
  const out = new Float32Array(total);
  let offset = 0;
  for (const block of blocks) {
    out.set(block, offset);
    offset += block.length;
  }
  return out;
}

export interface PcmCollector {
  /** False quando o grafo de captura nao pode ser criado. */
  available?: boolean;
  /** Encerra a coleta e devolve o PCM mono a 16 kHz acumulado. */
  stop(): Float32Array;
  /** Amostras acumuladas ate agora. Diagnostico. */
  sampleCount(): number;
}

/** Superficie minima do `AudioContext` que este modulo usa. */
export interface AudioCaptureEnvironment {
  sampleRate: number;
  createProcessor(
    onBlock: (channels: Float32Array[]) => void,
  ): { disconnect(): void } | null;
}

/**
 * Acumula PCM da captura, ja em mono 16 kHz.
 *
 * **Nunca lanca.** Um ambiente sem `AudioContext` utilizavel devolve um coletor
 * que entrega zero amostras, e o motor de ASR trata isso como ausencia - e nao
 * como falha de sessao.
 */
export function startPcmCollection(
  environment: AudioCaptureEnvironment,
): PcmCollector {
  const blocks: Float32Array[] = [];
  let samples = 0;

  const processor = environment.createProcessor((channels) => {
    const mono = toMono(channels);
    if (mono.length === 0) return;
    const resampled = resampleLinear(mono, environment.sampleRate);
    // `slice` desacopla do buffer que o navegador reaproveita entre blocos.
    blocks.push(resampled.slice());
    samples += resampled.length;
  });

  return {
    available: processor !== null,
    sampleCount: () => samples,
    stop() {
      try {
        processor?.disconnect();
      } catch {
        // Desconectar nao pode ser o que derruba o fim da sessao.
      }
      return concatPcm(blocks);
    },
  };
}
