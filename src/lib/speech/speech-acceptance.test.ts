import { describe, expect, it } from "vitest";

import {
  concatPcm,
  resampleLinear,
  toMono,
} from "@/lib/speech/audio-pipeline";
import { createLocalModelEngine } from "@/lib/speech/local-model-engine";
import {
  VAD_SPEECH_THRESHOLD,
  acceptSegment,
  acceptedWordCount,
  buildTranscription,
  countSpeechWords,
  isNonSpeechOnly,
  joinAccepted,
  stripNonSpeechMarkup,
} from "@/lib/speech/segment-acceptance";
import type { SpeechCandidate } from "@/lib/speech/types";
import {
  MAX_SPEECH_SEGMENT_MS,
  VAD_SAMPLE_RATE,
  VAD_WINDOW_SAMPLES,
  detectSpeechSegments,
  splitLongSegment,
  toCandidates,
  type VadSession,
} from "@/lib/speech/vad";

/**
 * Guardrails do reconhecimento local.
 *
 * O que estes testes protegem, em uma frase: **o Whisper pode inventar uma
 * frase, e a Elyra nao pode publicar essa frase**. A validacao tecnica provou o
 * primeiro - 30 s de silencio digital produziram, 2 de 2,
 * "A gente tem que ter que fazer isso." Estes testes prendem o segundo.
 *
 * Os sinais adversariais reais (ventilador, teclado, musica, impacto) contra o
 * **modelo Silero de verdade** vivem em `scripts/qa-asr-guardrails.mjs`: exigem o
 * modelo provisionado, e sao QA de ambiente. Aqui a logica e exercitada com um
 * VAD sintetico, deterministicamente, sem WASM e sem modelo.
 */

/** VAD sintetico: probabilidade por janela, na ordem. */
function fakeVad(probabilities: readonly number[]): VadSession & { resets: number } {
  let index = 0;
  const session = {
    resets: 0,
    reset() {
      index = 0;
      session.resets += 1;
    },
    process() {
      return probabilities[index++] ?? 0;
    },
  };
  return session;
}

/** Audio de N janelas, com conteudo irrelevante: quem decide e o VAD sintetico. */
function audioOf(windows: number): Float32Array {
  return new Float32Array(windows * VAD_WINDOW_SAMPLES);
}

function candidate(overrides: Partial<SpeechCandidate> = {}): SpeechCandidate {
  return {
    startOffsetMs: 0,
    endOffsetMs: 2000,
    pcm: new Float32Array(16000),
    speechProbability: 0.95,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Marcacao de nao-fala
// ---------------------------------------------------------------------------

describe("marcacao de nao-fala nao e fala", () => {
  it("F. tag de musica sozinha nao vira frase da pessoa", () => {
    for (const text of ["[música]", "[Música]", "[music]", "(música)", "♪♪"]) {
      expect(isNonSpeechOnly(text), text).toBe(true);
      expect(countSpeechWords(text), text).toBe(0);
    }
  });

  it("tag junto de fala real remove so a tag", () => {
    /*
      Regra estrutural, e nao lista de palavras: o que define nao-fala e a
      **forma** - marcacao entre colchetes ou parenteses -, nao um vocabulario
      que envelheceria em silencio.
    */
    const text = "[música] eu estava dizendo que sim";
    expect(isNonSpeechOnly(text)).toBe(false);
    expect(stripNonSpeechMarkup(text)).toBe("eu estava dizendo que sim");
    expect(countSpeechWords(text)).toBe(5);
  });

  it("tag nao entra na contagem de palavras", () => {
    // Se contasse, `speech_rate` subiria por causa de um evento que nao e fala
    // de ninguem.
    expect(countSpeechWords("bom dia [aplausos] tudo bem")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Regra de aceitacao
// ---------------------------------------------------------------------------

describe("um trecho so vira fala se as quatro condicoes valerem", () => {
  it("N. VAD aceitou e o ASR produziu texto: aceito", () => {
    const result = acceptSegment(candidate(), { text: "bom dia, tudo bem?" });
    expect(result.rejection).toBeNull();
    expect(result.accepted?.text).toBe("bom dia, tudo bem?");
    expect(result.accepted?.wordCount).toBe(4);
  });

  it("M. VAD recusou: o trecho nao vira fala nem por chamada direta", () => {
    /*
      O orquestrador nem manda ao ASR quando o VAD recusa. Esta guarda existe
      porque uma chamada direta a esta funcao tambem precisa ser fail-closed - a
      trava nao pode depender de quem chama.
    */
    const result = acceptSegment(
      candidate({ speechProbability: VAD_SPEECH_THRESHOLD - 0.01 }),
      { text: "texto que nao deveria existir" },
    );
    expect(result.accepted).toBeNull();
    expect(result.rejection).toBe("vad_rejected");
  });

  it("texto vazio vira ausencia", () => {
    expect(acceptSegment(candidate(), { text: "   " }).rejection).toBe("empty_text");
  });

  it("so marcacao de nao-fala vira ausencia", () => {
    const result = acceptSegment(candidate(), { text: "[música]" });
    expect(result.accepted).toBeNull();
    expect(result.rejection).toBe("non_speech_only");
  });

  it("modelo que declara ausencia de fala e respeitado", () => {
    const result = acceptSegment(candidate(), {
      text: "uma frase plausivel",
      noSpeechProbability: 0.9,
    });
    expect(result.rejection).toBe("no_speech_probability");
  });

  it("ausencia da medida do modelo nao vira confianca", () => {
    /*
      `undefined` nao e zero. Quando o runtime nao expoe `no_speech`, esta
      condicao simplesmente nao opina - tratar ausencia de medida como "modelo
      confiante" seria inventar confianca.
    */
    const result = acceptSegment(candidate(), { text: "uma frase real" });
    expect(result.accepted).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Transcricao da sessao
// ---------------------------------------------------------------------------

describe("a transcricao preserva ordem e descarta o que nao passou", () => {
  it("D. trechos saem em ordem de tempo, e nao de conclusao", () => {
    /*
      O ASR pode terminar trechos fora de ordem. Remontar por ordem de conclusao
      contaria uma sessao que nao aconteceu.
    */
    const transcription = buildTranscription([
      {
        candidate: candidate({ startOffsetMs: 60000, endOffsetMs: 62000 }),
        outcome: { text: "terceiro" },
      },
      {
        candidate: candidate({ startOffsetMs: 0, endOffsetMs: 2000 }),
        outcome: { text: "primeiro" },
      },
      {
        candidate: candidate({ startOffsetMs: 30000, endOffsetMs: 32000 }),
        outcome: { text: "segundo" },
      },
    ]);
    expect(joinAccepted(transcription)).toBe("primeiro segundo terceiro");
  });

  it("texto recusado nao contamina a contagem de palavras", () => {
    const transcription = buildTranscription([
      { candidate: candidate({ startOffsetMs: 0 }), outcome: { text: "bom dia" } },
      { candidate: candidate({ startOffsetMs: 5000 }), outcome: { text: "[música]" } },
      {
        candidate: candidate({ startOffsetMs: 9000 }),
        outcome: { text: "frase fabricada", noSpeechProbability: 0.95 },
      },
    ]);

    expect(acceptedWordCount(transcription)).toBe(2);
    expect(transcription.rejected.map((item) => item.rejection)).toEqual([
      "non_speech_only",
      "no_speech_probability",
    ]);
    // O texto recusado fica **fora** do que sobe, e visivel so no diagnostico.
    expect(joinAccepted(transcription)).toBe("bom dia");
    expect(transcription.rejected[1]?.discardedText).toBe("frase fabricada");
  });
});

// ---------------------------------------------------------------------------
// Segmentacao do VAD
// ---------------------------------------------------------------------------

describe("o VAD recorta o que vai ao ASR", () => {
  const perWindowMs = (VAD_WINDOW_SAMPLES / VAD_SAMPLE_RATE) * 1000; // 32 ms

  it("A/B/C/E. audio sem fala nao produz nenhum trecho", async () => {
    // Silencio digital, ruido de sala, ventilador, impacto: o VAD real deu
    // p <= 0,0031 em todos (ver `qa:asr:guardrails`). Aqui: nenhum trecho.
    const vad = fakeVad(Array.from({ length: 100 }, () => 0.001));
    const segments = await detectSpeechSegments(audioOf(100), vad);
    expect(segments).toHaveLength(0);
  });

  it("H. fala continua produz um trecho", async () => {
    const vad = fakeVad(Array.from({ length: 60 }, () => 0.95));
    const segments = await detectSpeechSegments(audioOf(60), vad);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.speechProbability).toBeCloseTo(0.95, 5);
  });

  it("I. fala, silencio longo, fala: dois trechos, e o silencio fica de fora", async () => {
    const fala = Array.from({ length: 30 }, () => 0.9);
    const silencio = Array.from({ length: 40 }, () => 0.01);
    const vad = fakeVad([...fala, ...silencio, ...fala]);
    const segments = await detectSpeechSegments(audioOf(100), vad);

    expect(segments).toHaveLength(2);
    // O intervalo entre os dois trechos nao vira candidato - e nao ha o que o
    // ASR possa inventar sobre ele, porque ele nao chega la.
    expect(segments[1]!.startSample).toBeGreaterThan(segments[0]!.endSample);
  });

  it("pausa curta nao parte a frase em duas", async () => {
    // Meia dúzia de janelas abaixo do limiar sao uma respiracao, e nao o fim de
    // uma frase. As pausas continuam sendo medidas pela envoltoria RMS.
    const vad = fakeVad([
      ...Array.from({ length: 20 }, () => 0.9),
      ...Array.from({ length: 5 }, () => 0.05),
      ...Array.from({ length: 20 }, () => 0.9),
    ]);
    const segments = await detectSpeechSegments(audioOf(45), vad);
    expect(segments).toHaveLength(1);
  });

  it("pico isolado nao vira trecho", async () => {
    // Abaixo de VAD_MIN_SPEECH_MS: um fragmento sem contexto e onde o ASR mais
    // inventa.
    const vad = fakeVad([0.01, 0.99, 0.01, ...Array.from({ length: 40 }, () => 0.01)]);
    const segments = await detectSpeechSegments(audioOf(43), vad);
    expect(segments).toHaveLength(0);
  });

  it("os trechos sao disjuntos, entao nao ha o que deduplicar", async () => {
    const vad = fakeVad([
      ...Array.from({ length: 20 }, () => 0.9),
      ...Array.from({ length: 40 }, () => 0.01),
      ...Array.from({ length: 20 }, () => 0.9),
      ...Array.from({ length: 40 }, () => 0.01),
      ...Array.from({ length: 20 }, () => 0.9),
    ]);
    const segments = await detectSpeechSegments(audioOf(140), vad);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.startSample).toBeGreaterThanOrEqual(segments[i - 1]!.endSample);
    }
  });

  it("o estado do VAD e zerado a cada sessao", async () => {
    const vad = fakeVad([0.9]);
    await detectSpeechSegments(audioOf(3), vad);
    expect(vad.resets).toBe(1);
  });

  it("os offsets de sessao acompanham o inicio da captura", () => {
    // O microfone pode ser autorizado depois do inicio da sessao.
    const candidates = toCandidates(
      audioOf(100),
      [{ startSample: VAD_SAMPLE_RATE, endSample: VAD_SAMPLE_RATE * 2, speechProbability: 0.9 }],
      5000,
    );
    expect(candidates[0]!.startOffsetMs).toBe(6000);
    expect(candidates[0]!.endOffsetMs).toBe(7000);
    expect(perWindowMs).toBeCloseTo(32, 5);
  });
});

// ---------------------------------------------------------------------------
// Teto de duracao por trecho
// ---------------------------------------------------------------------------

describe("nenhum trecho chega ao ASR acima da janela nativa do modelo", () => {
  /** Fala continua de N segundos, sem nenhuma janela abaixo do limiar. */
  async function speechOf(seconds: number) {
    const windows = Math.ceil((seconds * VAD_SAMPLE_RATE) / VAD_WINDOW_SAMPLES);
    const vad = fakeVad(Array.from({ length: windows }, () => 0.9));
    return detectSpeechSegments(audioOf(windows), vad);
  }

  const durationMs = (segment: { startSample: number; endSample: number }) =>
    ((segment.endSample - segment.startSample) / VAD_SAMPLE_RATE) * 1000;

  it.each([
    ["A", 10],
    ["B", 30],
    ["C", 45],
    ["D", 60],
    ["E", 90],
  ])("%s. %ss de fala continua: nenhum pedaco passa do teto", async (_l, seconds) => {
    const segments = await speechOf(seconds);
    expect(segments.length).toBeGreaterThan(0);

    const total = segments.reduce((sum, item) => sum + durationMs(item), 0);
    // O numero de pedacos e exatamente o minimo necessario para respeitar o
    // teto - nem picotado a mais, nem um unico bloco longo demais.
    expect(segments).toHaveLength(Math.ceil(total / MAX_SPEECH_SEGMENT_MS));

    for (const segment of segments) {

      expect(durationMs(segment)).toBeLessThanOrEqual(MAX_SPEECH_SEGMENT_MS + 1);
      // E nenhum pedaco minusculo: fragmento sem contexto e onde o ASR inventa.
      expect(durationMs(segment)).toBeGreaterThanOrEqual(
        Math.min(total, 1000),
      );
    }
  });

  it("os pedacos sao contiguos: nada se perde entre eles", async () => {
    const segments = await speechOf(90);
    for (let i = 1; i < segments.length; i += 1) {
      // Fim de um e inicio do proximo. Sem buraco, e sem sobreposicao.
      expect(segments[i]!.startSample).toBe(segments[i - 1]!.endSample);
    }
  });

  it("nao ha sobreposicao, entao nao ha o que deduplicar", async () => {
    const segments = await speechOf(90);
    for (let i = 1; i < segments.length; i += 1) {
      expect(segments[i]!.startSample).toBeGreaterThanOrEqual(
        segments[i - 1]!.endSample,
      );
    }
  });

  it("o corte cai no ponto mais silencioso da faixa de busca", () => {
    /*
      Cortar no teto exato cairia no meio de uma palavra com a mesma
      probabilidade de cair em qualquer outro lugar. O corte procura a janela de
      menor probabilidade dentro dos ultimos 20% - o ponto mais proximo de uma
      pausa que existe dentro do trecho.
    */
    const maxSamples = 30 * VAD_SAMPLE_RATE;
    const windows = Math.ceil((40 * VAD_SAMPLE_RATE) / VAD_WINDOW_SAMPLES);
    const probabilities = Array.from({ length: windows }, () => 0.9);

    /*
      40 s com teto de 30 s viram dois pedacos de 20 s. O corte ideal cai em
      20 s; o vale colocado em 21 s esta dentro do raio de busca, entao o corte
      deve migrar para la em vez de ficar no ponto exato.
    */
    const valeIndex = Math.floor((21 * VAD_SAMPLE_RATE) / VAD_WINDOW_SAMPLES);
    probabilities[valeIndex] = 0.55;

    const pieces = splitLongSegment(
      { startSample: 0, endSample: 40 * VAD_SAMPLE_RATE, speechProbability: 0.9 },
      probabilities,
      0,
      maxSamples,
    );

    expect(pieces).toHaveLength(2);
    const cutSeconds = pieces[0]!.endSample / VAD_SAMPLE_RATE;
    expect(cutSeconds).toBeGreaterThan(20.9);
    expect(cutSeconds).toBeLessThan(21.1);
  });

  it("os offsets de sessao acompanham cada pedaco", async () => {
    const segments = await speechOf(90);
    const candidates = toCandidates(audioOf(3000), segments, 0);
    for (let i = 1; i < candidates.length; i += 1) {
      expect(candidates[i]!.startOffsetMs).toBeGreaterThanOrEqual(
        candidates[i - 1]!.endOffsetMs - 1,
      );
    }
    expect(candidates[0]!.startOffsetMs).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Orquestracao e isolamento de falha
// ---------------------------------------------------------------------------

describe("o ASR so ve o que o VAD aprovou", () => {
  function engineWith(
    probabilities: readonly number[],
    transcribe: (pcm: Float32Array) => Promise<{ text: string }>,
    seen: Float32Array[] = [],
  ) {
    return {
      seen,
      engine: createLocalModelEngine({
        pcm: () => audioOf(probabilities.length),
        vad: fakeVad(probabilities),
        asr: {
          async transcribe(pcm) {
            seen.push(pcm);
            return transcribe(pcm);
          },
        },
      }),
    };
  }

  it("M. energia sem fala: o ASR nao roda uma unica vez", async () => {
    /*
      A correcao central desta etapa. RMS mede energia, e ventilador ou teclado
      passam de qualquer limiar de energia. Quem decide se ha fala e o VAD - e
      quando ele recusa, o ASR **nao e chamado**.
    */
    const { engine, seen } = engineWith(
      Array.from({ length: 100 }, () => 0.002),
      async () => ({ text: "A gente tem que ter que fazer isso." }),
    );

    const result = await engine.stop();
    expect(seen).toHaveLength(0);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(result.transcription.accepted).toHaveLength(0);
    expect(joinAccepted(result.transcription)).toBe("");
  });

  it("N. VAD aceita: o ASR roda e o texto e aceito", async () => {
    const { engine, seen } = engineWith(
      Array.from({ length: 60 }, () => 0.95),
      async () => ({ text: "hoje foi um dia difícil" }),
    );

    const result = await engine.stop();
    expect(seen).toHaveLength(1);
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    expect(joinAccepted(result.transcription)).toBe("hoje foi um dia difícil");
    expect(acceptedWordCount(result.transcription)).toBe(5);
  });

  it("K. sem VAD nao ha reconhecimento, e a sessao continua", async () => {
    /*
      "O VAD nao carregou, entao manda direto ao ASR" seria remover a unica
      camada que impede silencio de virar frase. A resposta e ausencia.
    */
    const engine = createLocalModelEngine({
      pcm: () => audioOf(60),
      vad: null,
      asr: { async transcribe() { return { text: "nao deveria acontecer" }; } },
    });

    const result = await engine.stop();
    expect(result).toEqual({
      status: "unavailable",
      reason: "local_speech_unavailable",
    });
  });

  it("L. ASR que estoura num trecho nao derruba os outros", async () => {
    let call = 0;
    const engine = createLocalModelEngine({
      pcm: () => audioOf(140),
      vad: fakeVad([
        ...Array.from({ length: 20 }, () => 0.9),
        ...Array.from({ length: 40 }, () => 0.01),
        ...Array.from({ length: 20 }, () => 0.9),
        ...Array.from({ length: 40 }, () => 0.01),
        ...Array.from({ length: 20 }, () => 0.9),
      ]),
      asr: {
        async transcribe() {
          call += 1;
          if (call === 2) throw new Error("decode_failed");
          return { text: `trecho ${call}` };
        },
      },
    });

    const result = await engine.stop();
    expect(result.status).toBe("available");
    if (result.status !== "available") return;
    // Perder tres minutos porque um trecho de dois segundos estourou seria
    // trocar tudo por nada.
    expect(result.transcription.accepted).toHaveLength(2);
    expect(result.transcription.rejected).toHaveLength(1);
  });

  it("VAD que estoura vira falha tipada, e nao excecao", async () => {
    const engine = createLocalModelEngine({
      pcm: () => audioOf(60),
      vad: {
        reset() {},
        process() {
          throw new Error("vad_failed");
        },
      },
      asr: { async transcribe() { return { text: "x" }; } },
    });

    await expect(engine.stop()).resolves.toEqual({
      status: "failed",
      reason: "recognition_failed",
    });
    expect(engine.state()).toBe("failed");
  });

  it("sessao sem audio nao e falha", async () => {
    const engine = createLocalModelEngine({
      pcm: () => new Float32Array(0),
      vad: fakeVad([]),
      asr: { async transcribe() { return { text: "x" }; } },
    });
    const result = await engine.stop();
    expect(result.status).toBe("available");
  });
});

// ---------------------------------------------------------------------------
// Preparo do audio
// ---------------------------------------------------------------------------

describe("preparo do audio", () => {
  it("mistura canais em vez de descartar um lado", () => {
    const mono = toMono([
      Float32Array.from([1, 0, -1]),
      Float32Array.from([0, 0, 1]),
    ]);
    expect(Array.from(mono)).toEqual([0.5, 0, 0]);
  });

  it("reamostra para a taxa do modelo", () => {
    const input = Float32Array.from({ length: 48000 }, (_, i) =>
      Math.sin((2 * Math.PI * 100 * i) / 48000),
    );
    expect(resampleLinear(input, 48000).length).toBe(16000);
  });

  it("taxa igual nao reamostra", () => {
    const input = Float32Array.from([1, 2, 3]);
    expect(resampleLinear(input, 16000)).toBe(input);
  });

  it("concatena preservando a ordem", () => {
    const out = concatPcm([Float32Array.from([1, 2]), Float32Array.from([3])]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});
