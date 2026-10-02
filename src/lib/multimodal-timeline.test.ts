import { describe, expect, it } from "vitest";

import {
  MIN_WINDOWS_FOR_TIMELINE,
  SIGNAL_WINDOW_MS,
  WINDOWED_SIGNALS,
  buildSignalWindows,
} from "@/lib/multimodal-timeline";
import {
  computePauseSignals,
  computeVocalVariation,
} from "@/lib/multimodal-signals";

const FRAME_MS = 100;
const FRAME_INTERVAL_MS = 200;

/** Envoltoria de `minutes` minutos: energia alta, com um bloco de silencio. */
function envelope(minutes: number, silentMinute: number | null = null): number[] {
  const perMinute = SIGNAL_WINDOW_MS / FRAME_MS;
  const values: number[] = [];
  for (let minute = 0; minute < minutes; minute += 1) {
    for (let frame = 0; frame < perMinute; frame += 1) {
      // Silencio contiguo de 20 s no minuto escolhido: bem acima de
      // `PAUSE_MINIMUM_MS`, entao vira pausa de verdade e nao respiro.
      const quiet = minute === silentMinute && frame < perMinute / 3;
      values.push(quiet ? 0.001 : 0.5);
    }
  }
  return values;
}

function windowsFor(minutes: number, silentMinute: number | null = null) {
  return buildSignalWindows({
    durationMs: minutes * SIGNAL_WINDOW_MS,
    capturedResources: ["microphone"],
    audioEnvelope: envelope(minutes, silentMinute),
    audioFrameMs: FRAME_MS,
    frameDifferences: [],
    frameIntervalMs: FRAME_INTERVAL_MS,
  });
}

describe("a serie so existe quando ha serie", () => {
  it("sessao curta demais nao produz janela", () => {
    expect(windowsFor(1)).toEqual([]);
  });

  /**
   * Com uma janela so, "serie temporal" e o agregado da sessao com outro nome -
   * e apresentar isso como leitura ao longo do tempo afirmaria variacao que
   * ninguem observou.
   */
  it("o minimo e declarado, e nao um acidente do laco", () => {
    expect(MIN_WINDOWS_FOR_TIMELINE).toBeGreaterThanOrEqual(2);
    expect(windowsFor(MIN_WINDOWS_FOR_TIMELINE).length).toBeGreaterThan(0);
  });
});

describe("offsets", () => {
  it("sao relativos ao inicio da sessao, e contiguos", () => {
    const windows = windowsFor(3).filter((w) => w.signal === "pause_count");
    expect(windows.map((w) => [w.startOffsetMs, w.endOffsetMs])).toEqual([
      [0, 60_000],
      [60_000, 120_000],
      [120_000, 180_000],
    ]);
  });

  it("nenhuma janela ultrapassa a duracao da sessao", () => {
    for (const window of windowsFor(4)) {
      expect(window.endOffsetMs).toBeLessThanOrEqual(4 * SIGNAL_WINDOW_MS);
    }
  });
});

describe("o recorte usa o mesmo motor do agregado", () => {
  /**
   * O ponto que impede um segundo motor: a janela de um minuto tem que produzir
   * exatamente o que a funcao do agregado produz para aquele mesmo minuto. Se
   * alguem escrever uma segunda aritmetica aqui, este teste reprova.
   */
  it("a janela reproduz a funcao do agregado sobre o mesmo recorte", () => {
    const minutes = 3;
    const samples = envelope(minutes, 1);
    const perMinute = SIGNAL_WINDOW_MS / FRAME_MS;
    const segundoMinuto = samples.slice(perMinute, perMinute * 2);

    const esperado = computePauseSignals(segundoMinuto, FRAME_MS);
    const janela = windowsFor(minutes, 1).find(
      (w) => w.signal === "pause_count" && w.startOffsetMs === 60_000,
    );

    expect(janela?.value).toBe(esperado.pauseCount);

    const variacao = windowsFor(minutes, 1).find(
      (w) => w.signal === "vocal_variation" && w.startOffsetMs === 60_000,
    );
    expect(variacao?.value).toBe(computeVocalVariation(segundoMinuto));
  });

  it("a janela silenciosa se distingue das outras", () => {
    const pausas = windowsFor(3, 1).filter((w) => w.signal === "pause_count");
    const silenciosa = pausas.find((w) => w.startOffsetMs === 60_000);
    const normal = pausas.find((w) => w.startOffsetMs === 0);
    expect(silenciosa!.value).toBeGreaterThan(normal!.value);
  });
});

describe("modalidade governa que janela existe", () => {
  it("sem camera nao ha janela de movimento", () => {
    const windows = windowsFor(3);
    expect(windows.some((w) => w.signal === "movement_frequency")).toBe(false);
  });

  it("sem microfone nao ha janela de audio", () => {
    const windows = buildSignalWindows({
      durationMs: 3 * SIGNAL_WINDOW_MS,
      capturedResources: ["camera"],
      audioEnvelope: envelope(3),
      audioFrameMs: FRAME_MS,
      frameDifferences: Array.from({ length: 900 }, (_, i) => (i % 7) / 10),
      frameIntervalMs: FRAME_INTERVAL_MS,
    });
    expect(windows.every((w) => w.signal === "movement_frequency")).toBe(true);
    expect(windows.length).toBeGreaterThan(0);
  });
});

describe("speech_rate nao tem janela", () => {

  it("nunca aparece na serie, em nenhuma configuracao", () => {
    const windows = buildSignalWindows({
      durationMs: 5 * SIGNAL_WINDOW_MS,
      capturedResources: ["microphone", "camera"],
      audioEnvelope: envelope(5, 2),
      audioFrameMs: FRAME_MS,
      frameDifferences: Array.from({ length: 1500 }, (_, i) => (i % 5) / 10),
      frameIntervalMs: FRAME_INTERVAL_MS,
    });
    /*
      A assercao de runtime sobre `w.signal === "speech_rate"` foi removida
      porque o **tipo** ja a torna impossivel de escrever: `WindowedSignalName`
      nao inclui `speech_rate`, e o compilador reprova a comparacao. Uma garantia
      de tipo e mais forte que a de teste - ela impede a construcao, em vez de
      pegar depois.

      O que continua verificavel em runtime e o conjunto exportado, que e o que
      os consumidores consultam.
    */
    expect(windows.length).toBeGreaterThan(0);
    expect([...WINDOWED_SIGNALS]).not.toContain("speech_rate");
  });
});
