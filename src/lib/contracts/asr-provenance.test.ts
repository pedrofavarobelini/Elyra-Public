import { describe, expect, it } from "vitest";

import {
  ASR_ENGINES,
  asrProvenanceLabel,
  asrProvenanceSchema,
  NATIVE_ASR_PROVENANCE,
  type AsrProvenance,
} from "./asr-provenance";
import {
  ASR_MODEL_ID,
  ASR_QUANTIZATION,
  ASR_RUNTIME,
  ASR_RUNTIME_VERSION,
  LOCAL_WHISPER_PROVENANCE,
  VAD_MODEL_VERSION,
} from "@/lib/speech/browser-runtime";
import packageJson from "../../../package.json";

describe("proveniencia do ASR", () => {
  it("distingue o Whisper local do reconhecedor nativo", () => {
    /*
      O finding que este contrato fecha: os dois motores eram persistidos sob
      `on_device_speech_api`, entao a coluna nao permitia saber qual deles
      produziu o texto.
    */
    expect(LOCAL_WHISPER_PROVENANCE.engine).toBe("local_whisper");
    expect(NATIVE_ASR_PROVENANCE.engine).toBe("native_speech_recognition");
    expect(LOCAL_WHISPER_PROVENANCE.engine).not.toBe(NATIVE_ASR_PROVENANCE.engine);
  });

  it("mantem o valor historico como motor NAO distinguido", () => {
    // Reescrever linhas antigas como nativas inventaria um fato nunca observado.
    expect(ASR_ENGINES).toContain("on_device_speech_api");
    expect(asrProvenanceSchema.parse({
      engine: "on_device_speech_api",
      model: null, quantization: null, runtime: null, runtimeVersion: null, vad: null,
    }).engine).toBe("on_device_speech_api");
  });

  it("TEST_FAILS_IF_PROVENANCE_IS_REMOVED: Whisper local exige detalhe reproduzivel", () => {
    for (const field of ["model", "quantization", "runtime", "runtimeVersion", "vad"] as const) {
      const incomplete: AsrProvenance = { ...LOCAL_WHISPER_PROVENANCE, [field]: null };
      expect(() => asrProvenanceSchema.parse(incomplete)).toThrow();
    }
  });

  it("motor nativo nao pode declarar modelo que o navegador nao publica", () => {
    expect(() => asrProvenanceSchema.parse({
      ...NATIVE_ASR_PROVENANCE,
      model: "whisper-base",
    })).toThrow();
  });

  it("a proveniencia acompanha o que o loader realmente carrega", () => {
    /*
      Derivada, e nao redigitada: um literal repetindo "whisper-base" seguiria
      dizendo isso depois de alguem trocar o modelo, e a transcricao seria
      gravada sob o nome do modelo anterior.
    */
    expect(LOCAL_WHISPER_PROVENANCE).toEqual({
      engine: "local_whisper",
      model: ASR_MODEL_ID,
      quantization: ASR_QUANTIZATION,
      runtime: ASR_RUNTIME,
      runtimeVersion: ASR_RUNTIME_VERSION,
      vad: VAD_MODEL_VERSION,
    });
    expect(ASR_MODEL_ID).toBe("onnx-community/whisper-small");
    expect(ASR_QUANTIZATION).toBe("q8");
    expect(VAD_MODEL_VERSION).toBe("silero_vad_v5");
  });

  it("a versao do runtime declarada e a versao instalada", () => {
    /*
      Esta e a garantia que substitui o `import` de package.json no bundle: se
      alguem atualizar `@huggingface/transformers` sem tocar na constante, a
      proveniencia passaria a mentir sobre o runtime que produziu o texto - e
      este teste quebra antes disso chegar ao banco.
    */
    const installed = packageJson.dependencies["@huggingface/transformers"];
    expect(installed.replace(/^[^\d]*/u, "")).toBe(ASR_RUNTIME_VERSION);
  });

  it("o rotulo descreve o caminho, e nunca a qualidade", () => {
    // PROVENANCE != ACCURACY: nenhum rotulo pode sugerir confianca.
    for (const engine of ASR_ENGINES) {
      const label = asrProvenanceLabel({
        engine, model: null, quantization: null, runtime: null, runtimeVersion: null, vad: null,
      } as AsrProvenance);
      expect(label).not.toMatch(/confiáve|precis|acurác|exat|confianç/iu);
    }
    expect(asrProvenanceLabel(null)).toBe("Origem da transcrição não registrada");
  });

  it("nao ha campo de confianca no contrato", () => {
    expect(() => asrProvenanceSchema.parse({
      ...LOCAL_WHISPER_PROVENANCE,
      confidence: 0.9,
    })).toThrow();
  });
});
