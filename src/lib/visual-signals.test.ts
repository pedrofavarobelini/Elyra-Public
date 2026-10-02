import { describe, expect, it } from "vitest";

import { coverageRatio } from "@/lib/contracts/capture-coverage";
import {
  VISUAL_SCENARIOS,
  sampleAt,
} from "@/lib/contracts/visual-fixtures";
import {
  HAND_MOVEMENT_THRESHOLD,
  HEAD_AMPLITUDE_REFERENCE_RAD,
  HEAD_MOVEMENT_THRESHOLD_RAD,
  TORSO_MOVEMENT_THRESHOLD,
  boundVisualSignal,
  buildVisualCoverage,
  computeVisualSignals,
  motionAmplitude,
  movementFrequency,
  sliceVisualSamples,
  visualPresence,
} from "@/lib/visual-signals";

describe("ausencia nao e zero", () => {
  it("devolve null quando nao houve rosto, e nao 0", () => {
    const signals = computeVisualSignals(VISUAL_SCENARIOS.zeroFace());

    expect(signals.head_movement_frequency).toBeNull();
    expect(signals.head_motion_amplitude).toBeNull();
    expect(signals.body_movement_frequency).toBeNull();
    expect(signals.hand_movement_frequency).toBeNull();
  });

  it("distingue mao ausente de mao parada", () => {
    const ausente = computeVisualSignals(VISUAL_SCENARIOS.handsAbsent());
    const parada = computeVisualSignals(
      Array.from({ length: 10 }, (_, index) => sampleAt(index * 160, { handDelta: 0 })),
    );

    // medimos" e "medimos e deu zero" nao podem produzir o mesmo numero.
    expect(ausente.hand_movement_frequency).toBeNull();
    expect(parada.hand_movement_frequency).toBe(0);
  });

  it("exige duas amostras comparaveis para o sinal existir", () => {
    expect(movementFrequency([0.5], HEAD_MOVEMENT_THRESHOLD_RAD)).toBeNull();
    expect(movementFrequency([0.5, 0.5], HEAD_MOVEMENT_THRESHOLD_RAD)).toBe(1);
  });
});

describe("o extrator discrimina movimento de estabilidade", () => {
  it("cabeca em movimento produz frequencia maior que cabeca estavel", () => {
    const estavel = computeVisualSignals(VISUAL_SCENARIOS.stableFace());
    const movimento = computeVisualSignals(VISUAL_SCENARIOS.movingHead());

    expect(estavel.head_movement_frequency).toBe(0);
    expect(movimento.head_movement_frequency).toBe(1);
    expect(movimento.head_motion_amplitude).toBeGreaterThan(
      estavel.head_motion_amplitude!,
    );
  });

  it("corpo em movimento produz frequencia maior que corpo estavel", () => {
    const estavel = computeVisualSignals(VISUAL_SCENARIOS.stableBody());
    const movimento = computeVisualSignals(VISUAL_SCENARIOS.movingBody());

    expect(estavel.body_movement_frequency).toBe(0);
    expect(movimento.body_movement_frequency).toBe(1);
  });

  it("maos em movimento produzem frequencia maior que maos paradas", () => {
    const movimento = computeVisualSignals(VISUAL_SCENARIOS.movingHands());
    expect(movimento.hand_movement_frequency).toBe(1);
  });

  it("os tres limiares sao independentes e separaveis", () => {
    /*
      Um deslocamento de 0,03 passa do limiar de tronco (0,02) e nao passa do de
      mao (0,05). Se alguem unificar os limiares, este teste cai - que e
      exatamente o ponto: mao e tronco nao se movem na mesma escala.
    */
    const meio = Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { torsoDelta: 0.03, handDelta: 0.03 }),
    );
    const signals = computeVisualSignals(meio);

    expect(TORSO_MOVEMENT_THRESHOLD).toBeLessThan(HAND_MOVEMENT_THRESHOLD);
    expect(signals.body_movement_frequency).toBe(1);
    expect(signals.hand_movement_frequency).toBe(0);
  });

  it("frequencia e a fracao das amostras, e nao um booleano", () => {
    const metade = Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, {
        headRotationDeltaRad: index < 5 ? 0.25 : 0.001,
      }),
    );
    expect(computeVisualSignals(metade).head_movement_frequency).toBe(0.5);
  });
});

describe("amplitude", () => {
  it("satura em 1 em vez de recusar o movimento grande", () => {
    const enorme = [HEAD_AMPLITUDE_REFERENCE_RAD * 10, HEAD_AMPLITUDE_REFERENCE_RAD * 10];
    expect(motionAmplitude(enorme, HEAD_AMPLITUDE_REFERENCE_RAD)).toBe(1);
  });

  it("usa todas as amostras comparaveis, e nao so as que passaram do limiar", () => {
    /*
      Um gesto isolado numa sessao parada nao pode produzir a mesma amplitude de
      uma sessao inteira em movimento. Media sobre as que passaram do limiar
      faria exatamente isso.
    */
    const umGesto = [0.5, 0, 0, 0, 0, 0, 0, 0, 0, 0];
    const sempre = Array.from({ length: 10 }, () => 0.5);

    const isolado = motionAmplitude(umGesto, HEAD_AMPLITUDE_REFERENCE_RAD)!;
    const continuo = motionAmplitude(sempre, HEAD_AMPLITUDE_REFERENCE_RAD)!;
    expect(isolado).toBeLessThan(continuo);
  });

  it("respeita o teto do contrato", () => {
    expect(boundVisualSignal("head_motion_amplitude", 5)).toBe(1);
    expect(boundVisualSignal("head_motion_amplitude", null)).toBeNull();
  });
});

describe("presenca e cobertura vem do tempo real, e nao do indice", () => {
  /** Observacao que comecou junto com a sessao e foi ate o fim. */
  const janelaCompleta = (endMs: number) => ({
    observationStartMs: 0,
    observationEndMs: endMs,
  });

  it("soma os spans reais entre amostras", () => {
    const presence = visualPresence(
      VISUAL_SCENARIOS.partialCapture(),
      (sample) => sample.facePresent,
      1600,
    );
    expect(presence.observedSamples).toBe(5);
    expect(presence.totalSamples).toBe(10);
    // Cinco amostras a 160 ms cada, tomadas dos instantes reais.
    expect(presence.observedMs).toBe(800);
    expect(presence.observationWindowMs).toBe(1600);
  });

  it("intervalo variavel nao e reconstruido pelo intervalo final", () => {
    /*
      O defeito que esta remediacao fechou.

      A amostragem e adaptativa: comeca em 160 ms e sobe ate 600 ms quando o
      aparelho nao da conta. `amostras x intervalo final` multiplicaria as
      amostras rapidas do inicio pelo intervalo lento do fim - aqui, 4 amostras
      x 600 ms = 2400 ms de "observacao" numa janela que durou 1080 ms.

      Os spans reais dao 1080. Se alguem voltar a derivar tempo de indice, este
      teste cai.
    */
    const amostras = [
      sampleAt(0),
      sampleAt(160),
      sampleAt(480),
      sampleAt(1080),
    ];
    const presence = visualPresence(
      amostras,
      (sample) => sample.facePresent,
      1680,
    );

    expect(presence.observedMs).toBe(1680);
    expect(presence.observedMs).not.toBe(amostras.length * 600);
  });

  it("amostra fora de ordem contribui zero, e nao tempo negativo", () => {
    const presence = visualPresence(
      [sampleAt(0), sampleAt(500), sampleAt(200)],
      (sample) => sample.facePresent,
      600,
    );
    expect(presence.observedMs).toBeGreaterThanOrEqual(0);
  });

  it("cobertura parcial por enquadramento e distinta de interrupcao", () => {
    const [face] = buildVisualCoverage(
      {
        state: "available",
        samples: VISUAL_SCENARIOS.partialCapture(),
        ...janelaCompleta(1600),
      },
      1600,
    );
    expect(face!.outcome).toBe("partial");
    expect(face!.reason).toBe("out_of_frame");

    const [interrompido] = buildVisualCoverage(
      {
        state: "partial",
        samples: VISUAL_SCENARIOS.partialCapture(),
        ...janelaCompleta(1600),
      },
      1600,
    );
    expect(interrompido!.reason).toBe("interrupted");
  });

  it("analise que sobe depois do inicio da sessao nao declara cobertura completa", () => {
    /*
      Carregar 21 MB de WASM e modelo leva segundos, e a sessao nao espera. Numa
      sessao de 60 s cuja analise subiu no segundo 5, os primeiros 5 segundos
      **nao foram observados por ninguem** - e a versao anterior declarava
      `60/60 full` porque o rosto aparecia em todas as amostras que existiram.
    */
    const SESSAO_MS = 60_000;
    const INICIO_MS = 5_000;
    const amostras = Array.from({ length: 344 }, (_, index) =>
      sampleAt(INICIO_MS + index * 160),
    );

    const [face] = buildVisualCoverage(
      {
        state: "available",
        samples: amostras,
        observationStartMs: INICIO_MS,
        observationEndMs: SESSAO_MS,
      },
      SESSAO_MS,
    );

    expect(face!.outcome).not.toBe("full");
    expect(face!.coverageMs).toBeLessThan(SESSAO_MS);
    // Aproximadamente os 55 s efetivamente observados.
    expect(face!.coverageMs).toBeGreaterThan(54_000);
    expect(face!.coverageMs).toBeLessThanOrEqual(55_000);
    expect(face!.reason).toBe("analysis_started_late");
  });

  it("o motivo declarado e o da maior lacuna", () => {
    /*
      Quando ha atraso de inicio **e** ausencia de enquadramento, explicar a
      sessao pelo atraso de 200 ms quando a pessoa passou metade do tempo fora
      do quadro seria escolher o motivo errado por precedencia fixa.
    */
    const SESSAO_MS = 20_000;
    const amostras = Array.from({ length: 100 }, (_, index) =>
      sampleAt(200 + index * 160, { facePresent: index < 50 }),
    );

    const [face] = buildVisualCoverage(
      {
        state: "available",
        samples: amostras,
        observationStartMs: 200,
        observationEndMs: SESSAO_MS,
      },
      SESSAO_MS,
    );
    expect(face!.reason).toBe("out_of_frame");
  });

  it("modalidade que nunca apareceu e not_observed, e nao error", () => {
    const [face] = buildVisualCoverage(
      {
        state: "available",
        samples: VISUAL_SCENARIOS.zeroFace(),
        ...janelaCompleta(1600),
      },
      1600,
    );
    // A analise rodou. O resultado dela foi ausencia - e isso nao e falha.
    expect(face!.outcome).toBe("absent");
    expect(face!.reason).toBe("not_observed");
    expect(face!.coverageMs).toBe(0);
  });

  it("sem consentimento a cobertura visual e not_requested", () => {
    const coverage = buildVisualCoverage(
      {
        state: "unavailable",
        samples: [],
        observationStartMs: null,
        observationEndMs: null,
      },
      1600,
    );
    expect(coverage).toHaveLength(3);
    for (const item of coverage) {
      expect(item.outcome).toBe("absent");
      expect(item.reason).toBe("not_requested");
    }
  });

  it("navegador sem suporte e diferente de motor quebrado", () => {
    const vazio = { observationStartMs: null, observationEndMs: null };
    const [sem] = buildVisualCoverage(
      { state: "unsupported", samples: [], ...vazio },
      1600,
    );
    const [quebrado] = buildVisualCoverage(
      { state: "failed", samples: [], ...vazio },
      1600,
    );
    expect(sem!.reason).toBe("unsupported");
    expect(quebrado!.reason).toBe("error");
  });

  it("uma unica amostra sem rosto ja impede cobertura completa", () => {
    const quase = Array.from({ length: 10 }, (_, index) =>
      sampleAt(index * 160, { facePresent: index !== 9 }),
    );
    const [face] = buildVisualCoverage(
      { state: "available", samples: quase, ...janelaCompleta(1600) },
      1600,
    );
    expect(face!.outcome).toBe("partial");
    expect(coverageRatio(face!)).toBeCloseTo(0.9, 5);
  });

  it("cobertura completa exige a sessao inteira observada e a modalidade sempre presente", () => {
    const todas = Array.from({ length: 10 }, (_, index) => sampleAt(index * 160));
    const [face] = buildVisualCoverage(
      { state: "available", samples: todas, ...janelaCompleta(1600) },
      1600,
    );
    expect(face!.outcome).toBe("full");
    expect(face!.reason).toBeNull();
  });
});

describe("recorte temporal", () => {
  it("recorta por instante, e nao por indice", () => {
    /*
      Amostragem adaptativa faz o intervalo variar dentro da sessao. Um recorte
      por indice deslocaria a janela justamente nas sessoes em que o aparelho
      engasgou - que sao as que mais precisam ser lidas com cuidado.
    */
    const irregular = [0, 160, 900, 1000, 1100].map((atMs) => sampleAt(atMs));
    const janela = sliceVisualSamples(irregular, 0, 1000);

    expect(janela.map((sample) => sample.atMs)).toEqual([0, 160, 900]);
  });

  it("o fim da janela e exclusivo", () => {
    const amostras = [sampleAt(0), sampleAt(1000)];
    expect(sliceVisualSamples(amostras, 0, 1000)).toHaveLength(1);
  });
});
