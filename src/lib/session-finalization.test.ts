import { describe, expect, it } from "vitest";

import {
  advanceFinalization,
  completeFinalization,
  createFinalization,
  finalizationElapsedSeconds,
  finalizationLabel,
  finalizationPercent,
  finalizationPlan,
  finalizationStalled,
  type FinalizationStep,
} from "./session-finalization";

const FULL = { transcribe: true, keepRecording: true, aiAnalysis: true, hasCapture: true };

describe("plano de finalizacao", () => {
  it("espelha o caminho real com todas as etapas ligadas", () => {
    expect(finalizationPlan(FULL)).toEqual([
      "stopping_capture",
      "consolidating_transcript",
      "consolidating_signals",
      "stopping_recording",
      "uploading_recording",
      "saving_session",
      "analyzing",
    ]);
  });

  it("IA OFF nao inclui etapa de IA: salva a analise sem esperar interpretacao", () => {
    const steps = finalizationPlan({ ...FULL, aiAnalysis: false });
    expect(steps).not.toContain("analyzing");
    expect(steps.at(-1)).toBe("saving_analysis");
  });

  it("etapas inexistentes nao entram no plano", () => {
    const steps = finalizationPlan({ ...FULL, transcribe: false, keepRecording: false });
    expect(steps).not.toContain("consolidating_transcript");
    expect(steps).not.toContain("uploading_recording");
  });

  it("sem captura nao ha analise nem upload a esperar", () => {
    expect(finalizationPlan({ ...FULL, hasCapture: false })).toEqual([
      "stopping_capture",
      "consolidating_transcript",
      "stopping_recording",
      "saving_session",
    ]);
  });
});

describe("percentual por marcos", () => {
  it("comeca em 0, avanca por marco e so chega a 100 na conclusao", () => {
    let state = createFinalization(FULL, 0);
    const seen = [finalizationPercent(state)];
    for (const step of state.steps.slice(1)) {
      state = advanceFinalization(state, step, 1);
      seen.push(finalizationPercent(state));
    }
    expect(seen[0]).toBe(0);
    for (let i = 1; i < seen.length; i += 1) expect(seen[i]).toBeGreaterThan(seen[i - 1] ?? Infinity);
    expect(Math.max(...seen)).toBeLessThan(100);
    state = completeFinalization(state, 2);
    expect(finalizationPercent(state)).toBe(100);
    expect(finalizationLabel(state)).toBe("Sessão finalizada");
  });

  it("nunca regride: etapa ja passada ou fora do plano nao muda o estado", () => {
    let state = createFinalization({ ...FULL, aiAnalysis: false }, 0);
    state = advanceFinalization(state, "saving_session", 1);
    const before = finalizationPercent(state);
    expect(advanceFinalization(state, "consolidating_signals", 2)).toBe(state);
    expect(advanceFinalization(state, "analyzing" as FinalizationStep, 2)).toBe(state);
    expect(finalizationPercent(state)).toBe(before);
    const done = completeFinalization(state, 3);
    expect(advanceFinalization(done, "saving_analysis", 4)).toBe(done);
    expect(finalizationPercent(done)).toBe(100);
  });

  it("nao arredonda para 100 antes da conclusao", () => {
    let state = createFinalization({ ...FULL, aiAnalysis: false }, 0);
    state = advanceFinalization(state, "saving_analysis", 1);
    expect(finalizationPercent(state)).toBeLessThanOrEqual(99);
  });

  it("o relogio nao move a barra", () => {
    const state = createFinalization(FULL, 0);
    expect(finalizationPercent(state)).toBe(0);
    expect(finalizationElapsedSeconds(state, 600_000)).toBe(600);
    expect(finalizationPercent(state)).toBe(0);
  });
});

describe("demora", () => {
  it("avisa depois do limiar da etapa, e reinicia a contagem no marco seguinte", () => {
    let state = createFinalization(FULL, 0);
    state = advanceFinalization(state, "analyzing", 1_000);
    expect(finalizationStalled(state, 30_000)).toBe(false);
    expect(finalizationStalled(state, 90_000)).toBe(true);
    expect(finalizationLabel(state)).toBe("Analisando a sessão");
    expect(finalizationStalled(completeFinalization(state, 90_000), 500_000)).toBe(false);
  });

  it("tempo decorrido nunca e negativo", () => {
    expect(finalizationElapsedSeconds(createFinalization(FULL, 5_000), 1_000)).toBe(0);
  });
});
