import { describe, expect, it } from "vitest";

import {
  DEGENERATE_TRANSFORMS,
  IDENTITY_TRANSFORM,
  fakeEngine,
  poseAt,
  scaledIdentity,
  step,
  yawTransform,
} from "@/lib/contracts/visual-fixtures";
import {
  VISUAL_INFERENCE_HARD_LIMIT_MS,
  VISUAL_OVER_LIMIT_STRIKES,
  VISUAL_SAMPLE_INTERVAL_CEILING_MS,
  VISUAL_WARMUP_TICKS,
  extractRotation,
  handDisplacement,
  handPoints,
  handsObserved,
  headRotationDelta,
  startVisualObservation,
  torsoDisplacement,
  torsoFrame,
} from "@/lib/visual-landmarks";

/**
 * Relogio controlado: nada aqui depende de tempo real.
 *
 * O coletor recebe `setTimeout`/`clearTimeout` por parametro: ha no maximo UM
 * tick pendente (agendamento serial), e a suite o dispara na mao. `delays`
 * guarda cada espera pedida, para provar o backoff.
 */
function controlledClock() {
  let handler: (() => void) | null = null;
  let cleared = 0;
  let pendingCount = 0;
  let maxPending = 0;
  const delays: number[] = [];
  return {
    get cleared() {
      return cleared;
    },
    get maxPending() {
      return maxPending;
    },
    get lastDelay() {
      return delays[delays.length - 1] ?? null;
    },
    delays,
    setTimeout(next: () => void, ms: number) {
      handler = next;
      pendingCount += 1;
      maxPending = Math.max(maxPending, pendingCount);
      delays.push(ms);
      return delays.length;
    },
    clearTimeout() {
      cleared += 1;
      if (pendingCount > 0) pendingCount -= 1;
      handler = null;
    },
    tick(times = 1) {
      for (let index = 0; index < times; index += 1) {
        const run = handler;
        handler = null;
        if (pendingCount > 0) pendingCount -= 1;
        run?.();
      }
    },
  };
}

/** Relogio de custo: cada inferencia "gasta" o que o teste mandar. */
function costClock(costs: () => number) {
  let t = 0;
  let inside = false;
  return () => {
    if (!inside) {
      inside = true;
      return t;
    }
    inside = false;
    t += costs();
    return t;
  };
}

describe("geometria da cabeca: a escala nao pode virar movimento", () => {
  it("mede o angulo relativo, e nao a orientacao absoluta", () => {
    expect(headRotationDelta(IDENTITY_TRANSFORM, IDENTITY_TRANSFORM)).toBeCloseTo(
      0,
      6,
    );
    expect(headRotationDelta(IDENTITY_TRANSFORM, yawTransform(0.3))).toBeCloseTo(
      0.3,
      5,
    );
  });

  it("duas cabecas viradas do mesmo jeito produzem delta zero", () => {
    /*
      A prova de que a medida e relativa: alguem sentado de lado a sessao
      inteira nao pode aparecer como "cabeca em movimento" so por estar de lado.
    */
    expect(headRotationDelta(yawTransform(0.8), yawTransform(0.8))).toBeCloseTo(
      0,
      6,
    );
  });

  it("mesma orientacao com escala constante diferente de 1 nao produz movimento", () => {
    /*
      O caso que a primeira versao errava, e que nao dependia de a escala mudar.
      Com o bloco 3x3 valendo `s.R`, o traco vira `s^2 . tr(I)` e
      `acos((3 . 0,64 - 1) / 2)` da cerca de 1,09 rad - mais de 60 graus de
      movimento inventado, toda amostra, numa pessoa completamente imovel.
    */
    for (const scale of [0.8, 1.2, 2.5]) {
      expect(
        headRotationDelta(scaledIdentity(scale), scaledIdentity(scale)),
      ).toBeCloseTo(0, 5);
    }
  });

  it("mesma orientacao com escalas diferentes entre quadros nao produz movimento", () => {
    // Aproximar-se ou afastar-se da camera muda a escala estimada. Nao e girar a
    // cabeca, e nao pode ser medido como se fosse.
    for (const [antes, depois] of [
      [0.8, 1.0],
      [1.0, 1.2],
      [1.2, 0.8],
    ]) {
      expect(
        headRotationDelta(scaledIdentity(antes!), scaledIdentity(depois!)),
      ).toBeCloseTo(0, 5);
    }
  });

  it("yaw conhecido sobrevive a mudanca de escala entre quadros", () => {
    for (const [antes, depois] of [
      [1.0, 1.0],
      [0.8, 1.2],
      [1.2, 0.8],
    ]) {
      const delta = headRotationDelta(
        yawTransform(0, antes),
        yawTransform(0.4, depois),
      );
      // O angulo medido e o angulo girado, e nao o angulo girado somado a um
      // termo de escala.
      expect(delta).toBeCloseTo(0.4, 5);
    }
  });

  it("transformacao degenerada devolve ausencia, e nunca um angulo", () => {
    for (const [nome, matriz] of Object.entries(DEGENERATE_TRANSFORMS)) {
      expect(extractRotation(matriz), nome).toBeNull();
      expect(headRotationDelta(IDENTITY_TRANSFORM, matriz), nome).toBeNull();
    }
  });

  it("sem rosto anterior nao ha delta, e nao ha zero", () => {
    expect(headRotationDelta(null, IDENTITY_TRANSFORM)).toBeNull();
    expect(headRotationDelta(IDENTITY_TRANSFORM, null)).toBeNull();
  });

  it("a rotacao extraida e ortonormal, com escala removida", () => {
    const rotacao = extractRotation(yawTransform(0.7, 1.9))!;
    expect(rotacao).not.toBeNull();

    const coluna = (index: number) => rotacao.slice(index * 3, index * 3 + 3);
    for (let index = 0; index < 3; index += 1) {
      const c = coluna(index);
      expect(Math.hypot(c[0]!, c[1]!, c[2]!)).toBeCloseTo(1, 6);
    }
    const [a, b] = [coluna(0), coluna(1)];
    expect(a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!).toBeCloseTo(0, 6);
  });
});

describe("geometria do corpo", () => {
  it("normaliza pela largura de ombro, tornando a medida invariante a distancia", () => {
    /*
      A mesma pessoa, o mesmo movimento, duas distancias da camera. Sem
      normalizacao, chegar mais perto do notebook multiplicaria o movimento
      medido e a pessoa pareceria mais agitada por ter se aproximado.
    */
    const longe = torsoFrame(poseAt({ centerX: 0.5, centerY: 0.5 }));
    const longeDepois = torsoFrame(poseAt({ centerX: 0.52, centerY: 0.5 }));

    const perto = torsoFrame(
      poseAt({ centerX: 0.5, centerY: 0.5 }).map((point, index) =>
        index === 11 || index === 12
          ? { ...point, x: 0.5 + (point.x - 0.5) * 2 }
          : point,
      ),
    );
    const pertoDepois = torsoFrame(
      poseAt({ centerX: 0.5, centerY: 0.5 }).map((point, index) =>
        index === 11 || index === 12
          ? { ...point, x: 0.54 + (point.x - 0.5) * 2 }
          : { ...point, x: point.x + 0.04 },
      ),
    );

    expect(torsoDisplacement(longe, longeDepois)).toBeCloseTo(
      torsoDisplacement(perto, pertoDepois)!,
      5,
    );
  });

  it("ponto de baixa confianca nao conta como observado", () => {
    expect(torsoFrame(poseAt({ centerX: 0.5, centerY: 0.5, visible: false }))).toBeNull();
  });

  it("maos fora do quadro nao produzem deslocamento", () => {
    const semMaos = handPoints(
      poseAt({ centerX: 0.5, centerY: 0.5, handsVisible: false }),
    );
    expect(handsObserved(semMaos)).toBe(false);
    expect(handDisplacement(null, semMaos, 0.2)).toBeNull();
  });
});

describe("maos: magnitude antes de agregacao", () => {
  const ESCALA = 0.2;
  const base = { centerX: 0.5, centerY: 0.5 };
  const maos = (o: Parameters<typeof poseAt>[0]) => handPoints(poseAt(o));

  it("duas maos paradas nao produzem movimento", () => {
    expect(handDisplacement(maos(base), maos(base), ESCALA)).toBeCloseTo(0, 6);
  });

  it("uma mao que se move produz mais que duas paradas", () => {
    const paradas = handDisplacement(maos(base), maos(base), ESCALA)!;
    const uma = handDisplacement(
      maos(base),
      maos({ ...base, leftHandOffsetX: 0.06 }),
      ESCALA,
    )!;
    expect(uma).toBeGreaterThan(paradas);
  });

  it("duas maos na mesma direcao produzem mais que paradas", () => {
    const paradas = handDisplacement(maos(base), maos(base), ESCALA)!;
    const juntas = handDisplacement(
      maos(base),
      maos({ ...base, leftHandOffsetX: 0.06, rightHandOffsetX: 0.06 }),
      ESCALA,
    )!;
    expect(juntas).toBeGreaterThan(paradas);
  });

  it("duas maos em direcoes opostas NAO se anulam", () => {
    /*
      O caso cego da implementacao anterior, e o motivo desta remediacao.

      Com centroide conjunto das duas maos, a esquerda indo para a esquerda e a
      direita indo para a direita na mesma medida movem o centroide para lugar
      nenhum. `hand_movement_frequency` ficava perto de zero durante gesticulacao
      bilateral simetrica - que e das formas mais comuns de gesticular.

      Se alguem voltar a agregar posicoes antes de medir a magnitude, este teste
      cai.
    */
    const paradas = handDisplacement(maos(base), maos(base), ESCALA)!;
    const simetrico = handDisplacement(
      maos(base),
      maos({ ...base, leftHandOffsetX: -0.06, rightHandOffsetX: 0.06 }),
      ESCALA,
    )!;
    expect(simetrico).toBeGreaterThan(paradas);

    // E nao so "maior que zero": vale o mesmo que o movimento na mesma direcao
    // de igual magnitude por mao, porque cada mao percorreu a mesma distancia.
    const mesmaDirecao = handDisplacement(
      maos(base),
      maos({ ...base, leftHandOffsetX: 0.06, rightHandOffsetX: 0.06 }),
      ESCALA,
    )!;
    expect(simetrico).toBeCloseTo(mesmaDirecao, 6);
  });

  it("keypoint visto so numa das amostras nao conta distancia", () => {
    // Uma mao que entra no quadro nao percorreu distancia nenhuma: ela so passou
    // a ser vista.
    const fora = maos({ ...base, handsVisible: false });
    const dentro = maos(base);
    expect(handDisplacement(fora, dentro, ESCALA)).toBeNull();
  });
});

describe("o coletor so deixa escalar atravessar", () => {
  it("uma amostra tem exatamente sete campos, e nenhum e coordenada", () => {
    const clock = controlledClock();
    const engine = fakeEngine([
      step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 })),
      step(yawTransform(0.3), poseAt({ centerX: 0.55, centerY: 0.5 })),
    ]);
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    clock.tick(4);
    const { samples } = collector.stop();

    /*
      A prova estrutural do contrato de privacidade: 468 landmarks faciais sao um
      template biometrico, e a unica versao segura da regra e a que nao depende
      de ninguem lembrar dela. Se alguem acrescentar `landmarks` a amostra "so
      para depurar", este teste cai.
    */
    expect(Object.keys(samples[0]!).sort()).toEqual([
      "atMs",
      "bodyPresent",
      "facePresent",
      "handDelta",
      "handsPresent",
      "headRotationDeltaRad",
      "torsoDelta",
    ]);
    for (const value of Object.values(samples[1]!)) {
      expect(["number", "boolean", "object"]).toContain(typeof value);
      expect(Array.isArray(value)).toBe(false);
    }
  });

  it("a primeira amostra nao tem delta: nao havia com o que comparar", () => {
    const clock = controlledClock();
    const collector = startVisualObservation({
      engine: fakeEngine([
        step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 })),
      ]),
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    clock.tick(2);
    const { samples } = collector.stop();

    expect(samples[0]!.facePresent).toBe(true);
    expect(samples[0]!.headRotationDeltaRad).toBeNull();
  });
});

describe("isolamento de falha", () => {
  it("inferencia que estoura nao lanca para fora", () => {
    const clock = controlledClock();
    const collector = startVisualObservation({
      engine: fakeEngine([], { throwAt: 0 }),
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    expect(() => clock.tick(3)).not.toThrow();
    expect(collector.stop().state).toBe("failed");
  });

  it("motor que quebra no meio preserva o que ja foi medido", () => {
    const clock = controlledClock();
    const collector = startVisualObservation({
      engine: fakeEngine(
        [
          step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 })),
          step(yawTransform(0.2), poseAt({ centerX: 0.52, centerY: 0.5 })),
        ],
        { throwAt: 2 },
      ),
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    clock.tick(6);
    const result = collector.stop();

    // `partial`, e nao `failed`: houve medida, e ela nao e descartada porque o
    // que veio depois quebrou.
    expect(result.state).toBe("partial");
    expect(result.samples).toHaveLength(2);
  });

  it("motor que nunca produziu amostra e unavailable, e nao zero", () => {
    const clock = controlledClock();
    const collector = startVisualObservation({
      engine: fakeEngine([]),
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    const result = collector.stop();

    expect(result.state).toBe("unavailable");
    expect(result.samples).toHaveLength(0);
    expect(result.meanInferenceMs).toBeNull();
  });

  it("fechar o motor nao pode derrubar o fim da sessao", () => {
    const clock = controlledClock();
    const engine = fakeEngine([]);
    engine.close = () => {
      throw new Error("close_failed");
    };
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });

    expect(() => collector.stop()).not.toThrow();
  });

  it("parar libera o temporizador e fecha o motor", () => {
    const clock = controlledClock();
    const engine = fakeEngine([
      step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 })),
    ]);
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    clock.tick(2);
    collector.stop();

    expect(engine.closed).toBe(1);
    expect(clock.cleared).toBeGreaterThan(0);
  });

  it("nao amostra mais depois de parada", () => {
    const clock = controlledClock();
    const engine = fakeEngine([
      step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 })),
    ]);
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
    });
    clock.tick(2);
    const before = engine.detections;
    collector.stop();
    clock.tick(3);

    expect(engine.detections).toBe(before);
  });
});

describe("agendamento serial e desempenho (L-396)", () => {
  const ONE = [step(IDENTITY_TRANSFORM, poseAt({ centerX: 0.5, centerY: 0.5 }))];

  it("nunca ha duas inferencias ao mesmo tempo nem mais de um tick pendente", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    clock.tick(20);
    collector.stop();
    expect(engine.maxConcurrent).toBe(1);
    expect(clock.maxPending).toBe(1);
  });

  it("rosto e corpo se alternam: um detector por tick, amostra no tick de corpo", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    clock.tick(1);
    expect([engine.faceCalls, engine.poseCalls]).toEqual([1, 0]);
    expect(collector.stop().samples).toHaveLength(0);
    const again = controlledClock();
    const second = fakeEngine(ONE);
    const other = startVisualObservation({ engine: second, now: () => 0, setTimeout: again.setTimeout, clearTimeout: again.clearTimeout });
    again.tick(6);
    expect([second.faceCalls, second.poseCalls]).toEqual([3, 3]);
    expect(other.stop().samples).toHaveLength(3);
  });

  it("video sem quadro (0x0 / sem dados): nao chama o motor, nao gera erro e espera", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE, { ready: false });
    const statuses: string[] = [];
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout, onStatus: (s) => statuses.push(s) });
    clock.tick(5);
    expect(engine.faceCalls + engine.poseCalls).toBe(0);
    expect(collector.status()).toBe("waiting_video");
    engine.setReady(true);
    clock.tick(2);
    expect(collector.status()).toBe("active");
    expect(collector.stop().state).toBe("available");
    expect(statuses).toEqual(["waiting_video", "active", "stopped"]);
  });

  it("status nao diz ativa antes da primeira amostra valida", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    expect(collector.status()).toBe("preparing");
    clock.tick(1);
    expect(collector.status()).toBe("preparing");
    clock.tick(1);
    expect(collector.status()).toBe("active");
  });

  it("inferencia cara alarga a espera (custo x 1.5), dentro do teto", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      intervalMs: 160,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      clock: costClock(() => 400),
    });
    clock.tick(2);
    expect(clock.lastDelay).toBe(600);
    const result = collector.stop();
    expect(result.degradations).toBeGreaterThan(0);
    expect(result.sampleIntervalMs).toBeLessThanOrEqual(VISUAL_SAMPLE_INTERVAL_CEILING_MS);
    expect(result.meanInferenceMs).toBe(400);
  });

  it("custo que volta ao normal devolve o intervalo ao alvo aos poucos", () => {
    const clock = controlledClock();
    let cost = 800;
    const collector = startVisualObservation({
      engine: fakeEngine(ONE),
      now: () => 0,
      intervalMs: 160,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      clock: costClock(() => cost),
    });
    clock.tick(2);
    const widened = clock.lastDelay!;
    cost = 5;
    clock.tick(20);
    expect(clock.lastDelay!).toBeLessThan(widened);
    expect(clock.lastDelay!).toBe(160);
    collector.stop();
  });

  it("acima do limite seguro por varios ticks (apos o aquecimento): pausa so a analise visual", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const statuses: string[] = [];
    const collector = startVisualObservation({
      engine,
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      clock: costClock(() => VISUAL_INFERENCE_HARD_LIMIT_MS + 100),
      onStatus: (s) => statuses.push(s),
    });
    clock.tick(VISUAL_WARMUP_TICKS + VISUAL_OVER_LIMIT_STRIKES);
    expect(collector.status()).toBe("paused_performance");
    const callsAtPause = engine.faceCalls + engine.poseCalls;
    clock.tick(10);
    expect(engine.faceCalls + engine.poseCalls, "parou de inferir").toBe(callsAtPause);
    const result = collector.stop();
    expect(result.pausedForPerformance).toBe(true);
    // Houve medida antes: `partial` (interrompida), nunca `available`.
    expect(result.state).toBe("partial");
    expect(statuses).toContain("paused_performance");
    expect(engine.closed).toBe(1);
  });

  it("aquecimento lento nao pausa: so o custo persistente depois dele", () => {
    const clock = controlledClock();
    let n = 0;
    const collector = startVisualObservation({
      engine: fakeEngine(ONE),
      now: () => 0,
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      clock: costClock(() => (++n <= VISUAL_WARMUP_TICKS ? 3000 : 50)),
    });
    clock.tick(VISUAL_WARMUP_TICKS + 10);
    expect(collector.status()).not.toBe("paused_performance");
    expect(collector.stop().pausedForPerformance).toBe(false);
  });

  it("o coletor repassa o relogio de sessao ao motor (monotonico vem de quem chama)", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    let t = 100;
    const collector = startVisualObservation({ engine, now: () => (t += 50), setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    clock.tick(6);
    collector.stop();
    const all = [...engine.timestamps.face, ...engine.timestamps.pose].sort((a, b) => a - b);
    for (let i = 1; i < all.length; i += 1) expect(all[i]!).toBeGreaterThan(all[i - 1]!);
  });

  it("falha so no corpo: sessao segue, o que foi medido fica", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE, { throwAt: 1, throwOn: "pose" });
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    expect(() => clock.tick(6)).not.toThrow();
    expect(collector.status()).toBe("failed");
    const result = collector.stop();
    expect(result.state).toBe("partial");
    expect(result.samples).toHaveLength(1);
  });

  it("stop duas vezes fecha o motor uma vez so e devolve o mesmo resultado", () => {
    const clock = controlledClock();
    const engine = fakeEngine(ONE);
    const collector = startVisualObservation({ engine, now: () => 0, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
    clock.tick(2);
    const first = collector.stop();
    const second = collector.stop();
    expect(engine.closed).toBe(1);
    expect(second.samples).toHaveLength(first.samples.length);
  });
});
