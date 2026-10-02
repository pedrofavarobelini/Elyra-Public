import { describe, expect, it } from "vitest";

import {
  ASR_DOWNLOAD_BYTES,
  ASR_MODEL_BYTES,
  ASR_MODEL_ID,
  ASR_QA_COMPARATOR_MODEL_ID,
  VAD_MODEL_BYTES,
} from "@/lib/speech/browser-runtime";



/** `whisper-small` q8: soma dos sete arquivos, conferida por sha256. */
const SMALL_BYTES = 251_846_613;
/** `whisper-base` q8, o comparador de QA. */
const BASE_BYTES = 79_664_191;
/** Silero VAD v5, o mesmo arquivo que o provisionamento verifica por digest. */
const SILERO_BYTES = 2_327_524;

describe("estimativa de download da transcricao local", () => {
  it("o padrao e o `small`, e o comparador e o `base`", () => {
    expect(ASR_MODEL_ID).toBe("onnx-community/whisper-small");
    expect(ASR_QA_COMPARATOR_MODEL_ID).toBe("onnx-community/whisper-base");
  });

  it("os bytes de cada modelo sao os medidos", () => {
    expect(ASR_MODEL_BYTES["onnx-community/whisper-small"]).toBe(SMALL_BYTES);
    expect(ASR_MODEL_BYTES["onnx-community/whisper-base"]).toBe(BASE_BYTES);
    expect(VAD_MODEL_BYTES).toBe(SILERO_BYTES);
  });

  it("a estimativa e modelo padrao + VAD, e nao o modelo antigo", () => {
    expect(ASR_DOWNLOAD_BYTES).toBe(SMALL_BYTES + SILERO_BYTES);
    expect(ASR_DOWNLOAD_BYTES).toBe(254_174_137);


    expect(ASR_DOWNLOAD_BYTES).not.toBe(76_000_000 + SILERO_BYTES);
    expect(ASR_DOWNLOAD_BYTES).not.toBe(BASE_BYTES + SILERO_BYTES);
  });

  it("o rotulo arredondado que a tela mostra e ~254 MB", () => {
    /*
      A mesma aritmetica do componente. Se alguem trocar a divisao por
      1_048_576, o numero cai para 242 e este teste morre — e a tela e o teste
      passam a discordar em vez de envelhecer juntos.
    */
    expect(Math.round(ASR_DOWNLOAD_BYTES / 1_000_000)).toBe(254);
    expect(Math.round(ASR_DOWNLOAD_BYTES / 1_000_000)).not.toBe(78);
  });

  it("a estimativa cobre pelo menos o modelo que vai ser baixado", () => {
    /*
      Amarra independente dos numeros acima: qualquer que seja o padrao, a
      estimativa nao pode ser menor que o modelo. Ela sobrevive a proxima troca
      sem edicao, e teria pego o finding original sozinha.
    */
    expect(ASR_DOWNLOAD_BYTES).toBeGreaterThanOrEqual(ASR_MODEL_BYTES[ASR_MODEL_ID]);
  });
});
