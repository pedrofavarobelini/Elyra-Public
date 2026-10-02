import { describe, expect, it } from "vitest";

import {
  BROKEN_LINKS,
  classifyBrokenLink,
  logicalPath,
  memoryMeasurementAvailable,
  sampleMemory,
  sanitizeMessage,
  type LoadEvent,
} from "@/lib/qa/asr-load-forensics";

/**
 * A regra que estes testes protegem:
 *
 * **nenhuma falha vira `load_failed` sem causa.**
 *
 * A H1-B fisica no Android devolveu exatamente isso para o `small`, e o
 * resultado foi um A/B inconclusivo que so um segundo teste fisico resolveria.
 * O custo de perder a causa e sempre pago por outra pessoa, mais tarde.
 */

const ENCODER = "onnx-community/whisper-small/onnx/encoder_model_quantized.onnx";
const DECODER = "onnx-community/whisper-small/onnx/decoder_model_merged_quantized.onnx";

function done(file: string): LoadEvent {
  return { status: "done", file };
}
function initiate(file: string): LoadEvent {
  return { status: "initiate", file };
}

describe("primeiro elo quebrado", () => {
  it("erro no encoder preserva `encoder_load`", () => {
    expect(
      classifyBrokenLink({
        events: [done("config.json"), initiate(ENCODER)],
        errorName: "Error",
        errorMessage: "Failed to load model from file",
      }),
    ).toBe("encoder_load");
  });

  it("erro no decoder preserva `decoder_load`", () => {
    expect(
      classifyBrokenLink({
        events: [done("config.json"), done(ENCODER), initiate(DECODER)],
        errorName: "Error",
        errorMessage: "Failed to load model from file",
      }),
    ).toBe("decoder_load");
  });

  it("encoder concluido e decoder nem iniciado ainda e `decoder_load`", () => {
    /*
      O encoder desceu inteiro; o proximo passo do fluxo e o decoder. Chamar
      isso de `encoder_load` mandaria a investigacao para o arquivo errado.
    */
    expect(
      classifyBrokenLink({
        events: [done(ENCODER)],
        errorName: "Error",
        errorMessage: "something went wrong",
      }),
    ).toBe("decoder_load");
  });

  it("falha de busca preserva `asset_fetch`", () => {
    expect(
      classifyBrokenLink({
        events: [initiate("config.json")],
        errorName: "TypeError",
        errorMessage: "Failed to fetch",
      }),
    ).toBe("asset_fetch");
  });

  it("falta de memoria preserva `memory_allocation`", () => {
    for (const message of [
      "Array buffer allocation failed",
      "Aborted(OOM)",
      "Cannot enlarge memory arrays",
      "memory access out of bounds",
      "failed to allocate memory",
    ]) {
      expect(
        classifyBrokenLink({
          events: [done(ENCODER), initiate(DECODER)],
          errorName: "Error",
          errorMessage: message,
        }),
        message,
      ).toBe("memory_allocation");
    }
  });

  it("memoria vence a posicao, e nao o contrario", () => {
    /*
      Uma falha de alocacao no meio do decoder tem posicao de decoder e causa de
      memoria. Classificar pela posicao mandaria alguem procurar um operador
      ONNX incompativel que nao existe.
    */
    expect(
      classifyBrokenLink({
        events: [done(ENCODER), initiate(DECODER)],
        errorName: "RangeError",
        errorMessage: "Array buffer allocation failed",
      }),
    ).toBe("memory_allocation");
  });

  it("runtime que nem subiu preserva `runtime_init`", () => {
    expect(
      classifyBrokenLink({
        events: [],
        errorName: "Error",
        errorMessage: "no available backend found. ERR: [wasm] RuntimeError",
      }),
    ).toBe("runtime_init");
  });

  it("`wasm` na mensagem NAO transforma falha de decoder em `runtime_init`", () => {
    /*
      A palavra "wasm" aparece em erro de sessao ONNX tambem. Sem a checagem de
      eventos, um decoder que estourou seria reportado como um runtime que nunca
      comecou — e a correcao iria para o lugar errado.
    */
    expect(
      classifyBrokenLink({
        events: [done(ENCODER), initiate(DECODER)],
        errorName: "Error",
        errorMessage: "[wasm] failed to create inference session",
      }),
    ).toBe("decoder_load");
  });

  it("causa desconhecida vira `unknown`, e nao um palpite plausivel", () => {
    expect(
      classifyBrokenLink({ events: [], errorName: null, errorMessage: null }),
    ).toBe("unknown");
    expect(
      classifyBrokenLink({
        events: [done(ENCODER), done(DECODER)],
        errorName: "Error",
        errorMessage: "algo totalmente inesperado",
      }),
    ).toBe("unknown");
  });

  it("toda saida pertence ao vocabulario fechado", () => {
    const cases: Parameters<typeof classifyBrokenLink>[0][] = [
      { events: [], errorName: null, errorMessage: null },
      { events: [done(ENCODER)], errorName: "Error", errorMessage: "x" },
      { events: [initiate("config.json")], errorName: "TypeError", errorMessage: "Failed to fetch" },
      { events: [], errorName: "RangeError", errorMessage: "Array buffer allocation failed" },
    ];
    for (const input of cases) {
      expect(BROKEN_LINKS).toContain(classifyBrokenLink(input));
    }
  });
});

describe("sanitizacao", () => {
  it("URL vira `[url]`", () => {
    expect(
      sanitizeMessage("failed to fetch https://tunel-de-exemplo.invalid/asr/x.onnx?v=2"),
    ).toBe("failed to fetch [url]");
  });

  it("mensagem longa e cortada", () => {
    expect(sanitizeMessage("x".repeat(1000))!.length).toBe(300);
  });

  it("ausencia continua ausencia", () => {
    expect(sanitizeMessage(null)).toBeNull();
    expect(sanitizeMessage("")).toBeNull();
  });

  it("caminho logico nao carrega host nem query", () => {
    expect(
      logicalPath("https://tunel.example.com/asr/models/onnx-community/whisper-small/config.json?v=2"),
    ).toBe("onnx-community/whisper-small/config.json");
    expect(logicalPath(null)).toBe("");
  });
});

describe("amostra de memoria", () => {
  it("ausencia de `performance.memory` devolve `null`, e nunca zero", () => {
    const original = Object.getOwnPropertyDescriptor(performance, "memory");
    delete (performance as unknown as { memory?: unknown }).memory;

    const sample = sampleMemory();
    expect(sample.usedHeapBytes).toBeNull();
    expect(sample.heapLimitBytes).toBeNull();
    expect(sample.usedHeapBytes).not.toBe(0);
    expect(memoryMeasurementAvailable()).toBe(false);

    if (original) Object.defineProperty(performance, "memory", original);
  });

  it("com a API presente, o teto sobe junto com o uso", () => {
    /*
      O teto e o que da escala ao pico. Um pico de 400 MB nao diz nada sozinho;
      ao lado de um teto de 512 MB, diz tudo.
    */
    const original = Object.getOwnPropertyDescriptor(performance, "memory");
    Object.defineProperty(performance, "memory", {
      configurable: true,
      value: { usedJSHeapSize: 149_200_000, totalJSHeapSize: 180_000_000, jsHeapSizeLimit: 512_000_000 },
    });

    const sample = sampleMemory();
    expect(sample.usedHeapBytes).toBe(149_200_000);
    expect(sample.heapLimitBytes).toBe(512_000_000);
    expect(memoryMeasurementAvailable()).toBe(true);

    if (original) Object.defineProperty(performance, "memory", original);
    else delete (performance as unknown as { memory?: unknown }).memory;
  });
});
