import { describe, expect, it } from "vitest";

import { supportsLandmarkEngine, supportsSimd } from "@/lib/visual-engine";

/**
 * Deteccao de capability do motor de landmarks.
 *
 * Nada aqui carrega o MediaPipe: `loadLandmarkEngine` e a unica funcao do modulo
 * que faz `import()`, e ela nao e exercitada por estes testes. O que se testa e
 * a pergunta feita **antes** de tentar carregar.
 */

/** Escopo que finge um `WebAssembly` com validacao controlada. */
function scopeWith(validate: unknown) {
  return {
    WebAssembly: validate === undefined ? {} : { validate },
  } as { WebAssembly?: { validate?: (bytes: BufferSource) => boolean } };
}

describe("suporte ao motor exige SIMD, e nao so WebAssembly", () => {
  it("o runtime deste ambiente tem SIMD", () => {
    // Ancora: se este teste falhar, os demais nao provam o que dizem provar.
    expect(supportsSimd()).toBe(true);
    expect(supportsLandmarkEngine()).toBe(true);
  });

  it("WebAssembly presente e SIMD ausente e unsupported, e nao suportado", () => {
    /*
      O defeito que esta remediacao fechou.

      `vision-assets.mjs` vendoriza **somente** a variante SIMD do runtime. Um
      navegador com WebAssembly e sem SIMD nao consegue rodar este motor - mas a
      deteccao anterior perguntava so por `WebAssembly` e classificava esse
      navegador como suportado. Ele seguia adiante, o carregamento estourava, e
      uma incompatibilidade **conhecida** chegava vestida de `load_failed`
      generico: alguem seria mandado procurar um bug onde ha um requisito.
    */
    const semSimd = scopeWith(() => false);
    expect(supportsSimd(semSimd)).toBe(false);
    expect(supportsLandmarkEngine(semSimd)).toBe(false);
  });

  it("a sonda depende do opcode SIMD, e nao do acaso", () => {
    /*
      Um `validate` que aceita qualquer coisa devolveria `true` mesmo sem SIMD.
      Este teste fixa que a resposta positiva vem de validar **o modulo com
      `i8x16.splat`**, e que o modulo tem a forma que se espera.
    */
    let recebido: Uint8Array | null = null;
    const espiao = scopeWith((bytes: BufferSource) => {
      recebido = new Uint8Array(bytes as ArrayBuffer);
      return true;
    });

    expect(supportsSimd(espiao)).toBe(true);
    const bytes = recebido as unknown as Uint8Array;
    expect(bytes).not.toBeNull();
    // Cabecalho `\0asm` + versao 1.
    expect(Array.from(bytes.slice(0, 8))).toEqual([0, 97, 115, 109, 1, 0, 0, 0]);
    // O prefixo SIMD `0xfd` seguido de `i8x16.splat` (`0x0f`).
    expect(Array.from(bytes)).toContain(0xfd);
    const prefixo = Array.from(bytes).indexOf(0xfd);
    expect(bytes[prefixo + 1]).toBe(0x0f);
  });

  it("sem WebAssembly nenhum, unsupported", () => {
    expect(supportsLandmarkEngine({} as never)).toBe(false);
  });

  it("WebAssembly sem validate nao e tratado como suportado", () => {
    expect(supportsLandmarkEngine(scopeWith(undefined))).toBe(false);
  });

  it("validate que lanca nao derruba a deteccao", () => {
    /*
      Um `validate` que lanca nao e um `validate` utilizavel - e a resposta certa
      e `unsupported`, nao uma excecao subindo para o meio do inicio da sessao.
    */
    const explosivo = scopeWith(() => {
      throw new Error("wasm_probe_failed");
    });
    expect(() => supportsSimd(explosivo)).not.toThrow();
    expect(supportsSimd(explosivo)).toBe(false);
  });

  it("validate que devolve valor nao booleano nao vira suporte", () => {
    // Fail-closed: so `true` conta como suporte.
    expect(supportsSimd(scopeWith(() => 1 as unknown as boolean))).toBe(false);
  });
});

describe("incidente 28/09 (L-395/L-396): log do runtime, video pronto, timestamp", async () => {
  const { isVideoFrameReady, nextTimestamp, routeKnownRuntimeInfo, KNOWN_RUNTIME_INFO_LINES } = await import("./visual-engine");

  it("o log informativo conhecido do XNNPACK vira info e nao aparece como erro", () => {
    const errors: unknown[][] = [];
    const infos: unknown[][] = [];
    const route = routeKnownRuntimeInfo((...a) => errors.push(a), (...a) => infos.push(a));
    route("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.");
    route("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.\n");
    expect(errors).toEqual([]);
    expect(infos).toHaveLength(2);
    expect(KNOWN_RUNTIME_INFO_LINES).toHaveLength(1);
  });

  it("erro real do MediaPipe continua erro (nada de filtro generico)", () => {
    const errors: unknown[][] = [];
    const infos: unknown[][] = [];
    const route = routeKnownRuntimeInfo((...a) => errors.push(a), (...a) => infos.push(a));
    route("E0928 graph.cc:1] Calculator failed: timestamp mismatch");
    route("INFO: something else");
    route("INFO: Created TensorFlow Lite XNNPACK delegate for CPU.", "extra");
    const boom = new Error("wasm abort");
    route(boom);
    expect(errors).toHaveLength(4);
    expect(errors[3]![0]).toBe(boom);
    expect(infos).toEqual([]);
  });

  const video = (over: Record<string, unknown> = {}) => ({
    readyState: 4,
    videoWidth: 640,
    videoHeight: 480,
    ended: false,
    srcObject: { active: true, getVideoTracks: () => [{ readyState: "live" }] },
    ...over,
  });

  it("video pronto so com dados, dimensao, nao encerrado e track viva", () => {
    expect(isVideoFrameReady(video())).toBe(true);
    expect(isVideoFrameReady(video({ readyState: 1 }))).toBe(false);
    expect(isVideoFrameReady(video({ videoWidth: 0, videoHeight: 0 }))).toBe(false);
    expect(isVideoFrameReady(video({ ended: true }))).toBe(false);
    expect(isVideoFrameReady(video({ srcObject: { active: false, getVideoTracks: () => [{ readyState: "live" }] } }))).toBe(false);
    expect(isVideoFrameReady(video({ srcObject: { active: true, getVideoTracks: () => [{ readyState: "ended" }] } }))).toBe(false);
    expect(isVideoFrameReady(video({ srcObject: { active: true, getVideoTracks: () => [] } }))).toBe(false);
    expect(isVideoFrameReady(null)).toBe(false);
  });

  it("timestamp por landmarker: crescente, finito, nao negativo, sem repeticao", () => {
    expect(nextTimestamp(-1, 0)).toBe(0);
    expect(nextTimestamp(100, 250.7)).toBe(250);
    expect(nextTimestamp(250, 250)).toBe(251);
    expect(nextTimestamp(250, 120)).toBe(251);
    expect(nextTimestamp(10, Number.NaN)).toBe(11);
    expect(nextTimestamp(10, Number.POSITIVE_INFINITY)).toBe(11);
    expect(nextTimestamp(-1, -50)).toBe(0);
  });
});
