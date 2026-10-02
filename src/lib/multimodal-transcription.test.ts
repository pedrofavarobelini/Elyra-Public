import { describe, expect, it, vi } from "vitest";

import {
  SPEECH_MAX_RESTARTS,
  SPEECH_QUALITY,
  VOICED_CONTRADICTION_MIN_MS,
  buildTranscriptSubmission,
  installLocalSpeech,
  probeLocalSpeechAvailability,
  startSessionTranscription,
  type LocalSpeechAvailability,
  type SpeechAvailabilityQuery,
  type SpeechEnvironment,
  type SpeechRecognitionLike,
  type SpeechResultEventLike,
} from "@/lib/multimodal-derivation";

/**
 * Transcricao: processamento local, ciclo de vida e contradicao entre sensores.
 *
 * Os tres defeitos que a **validacao fisica #1** expos. Nenhum deles aparecia em
 * teste sintetico antes, porque nenhum teste sintetico deixava o reconhecedor
 * encerrar sozinho no meio de uma sessao de tres minutos.
 */

/**
 * Reconhecedor sintetico com controle total sobre o ciclo de vida.
 *
 * `supportsProcessLocally` existe para exercitar a instancia que **nao** expoe a
 * propriedade - o navegador que aceitaria a atribuicao em silencio e processaria
 * onde quisesse.
 *
 * `processLocallyReadOnly` cobre o caso mais traicoeiro: a propriedade existe,
 * a atribuicao nao estoura, e o valor continua falso. Uma capability de
 * privacidade que so verifica presenca aceitaria isso.
 */
function fakeRecognition(
  options: { supportsProcessLocally?: boolean; processLocallyReadOnly?: boolean } = {},
) {
  const { supportsProcessLocally = true, processLocallyReadOnly = false } = options;

  const state = {
    starts: 0,
    stops: 0,
    lang: "",
    continuous: false,
    processLocallyAtStart: undefined as boolean | undefined,
    instance: null as SpeechRecognitionLike | null,
  };

  class Recognition implements SpeechRecognitionLike {
    lang = "";
    continuous = false;
    interimResults = false;
    onresult: ((event: SpeechResultEventLike) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;

    constructor() {
      if (supportsProcessLocally) {
        if (processLocallyReadOnly) {
          // Getter sem setter: aceita a atribuicao e ignora o valor.
          Object.defineProperty(this, "processLocally", {
            get: () => false,
            set: () => undefined,
            configurable: true,
          });
        } else {
          (this as SpeechRecognitionLike).processLocally = false;
        }
      }
      state.instance = this;
    }
    start() {
      state.starts += 1;
      state.lang = this.lang;
      state.continuous = this.continuous;
      state.processLocallyAtStart = (this as SpeechRecognitionLike).processLocally;
    }
    stop() {
      state.stops += 1;
      this.onend?.();
    }
    abort(): void {}
  }

  return { state, Recognition: Recognition as never };
}

/** Emite um resultado final, como o navegador faria. */
function emitFinal(instance: SpeechRecognitionLike, text: string) {
  instance.onresult?.({
    resultIndex: 0,
    results: [{ isFinal: true, length: 1, 0: { transcript: text } }],
  } as unknown as SpeechResultEventLike);
}

describe("fail closed: o reconhecimento so comeca com processamento local provado", () => {
  /*
    A regra canonica. `recognition.start()` so acontece quando **todas** valem:

      1. SpeechRecognition existe;
      2. a capability local foi sondada;
      3. a sonda respondeu "available";
      4. a instancia expoe `processLocally`;
      5. `processLocally = true` pegou de fato.

    Qualquer outro estado nao inicia. A contagem de `start` e a assercao central
    de quase todo teste daqui: ela e o unico jeito de provar que nenhum audio
    chegou a ser oferecido a um servico que talvez fosse remoto.
  */

  it("G. available + processLocally presente: inicia, e com a flag ja verdadeira", () => {
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
    });

    expect(state.starts).toBe(1);
    // A flag precisa valer `true` **antes** de `start`, e nao depois.
    expect(state.processLocallyAtStart).toBe(true);
    expect(state.lang).toBe("pt-BR");
    expect(state.continuous).toBe(true);
  });

  it("C. localAvailability ausente nao inicia", async () => {
    /*
      O buraco que a auditoria encontrou.

      A versao anterior escrevia `if (availability && availability !== ...)`, e o
      `&&` deixava `undefined` atravessar: quem chamasse sem passar prova nenhuma
      iniciava o reconhecimento. Chamada direta tambem precisa ser recusada - a
      trava nao pode depender de o caller lembrar.
    */
    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
    });

    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unverifiable",
    });
  });

  it("A. sonda unsupported nao inicia", async () => {

    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "unsupported",
    });

    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unverifiable",
    });
  });

  it("B. sonda que estoura vira unsupported, e nao inicia", async () => {
    const Probe = Object.assign(function () {} as never, {
      available: () => {
        throw new Error("probe_failed");
      },
    });
    const availability = await probeLocalSpeechAvailability({
      SpeechRecognition: Probe,
    } as SpeechEnvironment);
    expect(availability).toBe("unsupported");

    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: availability,
    });

    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unverifiable",
    });
  });

  it("D/E/F. resposta negativa do navegador nao inicia", async () => {
    // Aqui a sonda **respondeu**: o pacote de idioma nao esta pronto neste
    // aparelho. Motivo diferente de `unverifiable`, mesma decisao.
    for (const availability of [
      "unavailable",
      "downloadable",
      "downloading",
    ] as LocalSpeechAvailability[]) {
      const { state, Recognition } = fakeRecognition();
      const transcriber = startSessionTranscription({
        environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
        localAvailability: availability,
      });

      expect(state.starts, availability).toBe(0);
      await expect(transcriber!.stop()).resolves.toEqual({
        status: "unavailable",
        reason: "local_speech_unavailable",
      });
    }
  });

  it("H. available com processLocally ausente na instancia nao inicia", async () => {
    /*
      A sonda estatica diz o que o navegador consegue; a instancia diz o que ela
      aceita. Sem a propriedade nao ha como pedir processamento local, e "o
      browser provavelmente respeita" nao e garantia - e esperanca.
    */
    const { state, Recognition } = fakeRecognition({
      supportsProcessLocally: false,
    });
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
    });

    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unverifiable",
    });
  });

  it("processLocally que nao pega nao inicia", async () => {
    /*
      O caso mais traicoeiro: a propriedade existe, a atribuicao nao estoura, e o
      valor continua falso. Verificar so a presenca aceitaria isto - e por isso a
      trava confere o valor **depois** de atribuir.
    */
    const { state, Recognition } = fakeRecognition({
      processLocallyReadOnly: true,
    });
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
    });

    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unverifiable",
    });
  });

  it("os dois motivos dizem coisas diferentes", async () => {
    /*
      `unavailable` e uma resposta negativa - acionavel: da para instalar o
      idioma. `unverifiable` e ausencia de resposta - honesto sobre a incerteza.
      Fundir os dois tiraria da pessoa a informacao que permite agir.
    */
    const negativa = startSessionTranscription({
      environment: {
        SpeechRecognition: fakeRecognition().Recognition,
      } as SpeechEnvironment,
      localAvailability: "downloadable",
    })!;
    const semResposta = startSessionTranscription({
      environment: {
        SpeechRecognition: fakeRecognition().Recognition,
      } as SpeechEnvironment,
      localAvailability: "unsupported",
    })!;

    const a = await negativa.stop();
    const b = await semResposta.stop();
    expect(a).not.toEqual(b);
  });
});

describe("a sonda de disponibilidade local", () => {
  it("distingue os quatro estados que o navegador responde", async () => {
    for (const answer of [
      "available",
      "downloadable",
      "downloading",
      "unavailable",
    ]) {
      const Recognition = Object.assign(function () {} as never, {
        available: () => Promise.resolve(answer),
      });
      await expect(
        probeLocalSpeechAvailability({
          SpeechRecognition: Recognition,
        } as SpeechEnvironment),
      ).resolves.toBe(answer);
    }
  });

  it("navegador sem a API estatica devolve unsupported", async () => {
    // E `unsupported` **impede** o reconhecimento: ver o bloco acima.
    const { Recognition } = fakeRecognition();
    await expect(
      probeLocalSpeechAvailability({
        SpeechRecognition: Recognition,
      } as SpeechEnvironment),
    ).resolves.toBe("unsupported");
  });

  it("resposta desconhecida nao vira available", async () => {
    const Recognition = Object.assign(function () {} as never, {
      available: () => Promise.resolve("talvez"),
    });
    await expect(
      probeLocalSpeechAvailability({
        SpeechRecognition: Recognition,
      } as SpeechEnvironment),
    ).resolves.toBe("unavailable");
  });
});

describe("a consulta declara o perfil, e nao aceita o default da API", () => {
  /** Capta a consulta exata que foi feita ao navegador. */
  function spyEnvironment(
    answer: string,
    installResult: boolean | Error = true,
  ) {
    const queries: SpeechAvailabilityQuery[] = [];
    const installs: SpeechAvailabilityQuery[] = [];
    let current = answer;

    const Recognition = Object.assign(function () {} as never, {
      available: (query: SpeechAvailabilityQuery) => {
        queries.push(query);
        return Promise.resolve(current);
      },
      install: (query: SpeechAvailabilityQuery) => {
        installs.push(query);
        if (installResult instanceof Error) throw installResult;
        if (installResult) current = "available";
        return Promise.resolve(installResult);
      },
    });

    return {
      queries,
      installs,
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      set(next: string) {
        current = next;
      },
    };
  }

  it("E. sonda pede pt-BR, processamento local e qualidade dictation", async () => {
    /*
      `dictation`, e nao `conversation`: a sessao da Elyra e uma pessoa falando
      continuamente por varios minutos, e nao turnos curtos entre varios
      interlocutores. Sem `quality` declarado, a resposta dependia do default da
      API - fora do nosso controle e capaz de mudar entre versoes do navegador.
    */
    const spy = spyEnvironment("available");
    await probeLocalSpeechAvailability(spy.environment);

    expect(spy.queries).toHaveLength(1);
    expect(spy.queries[0]).toEqual({
      langs: ["pt-BR"],
      processLocally: true,
      quality: "dictation",
    });
    expect(SPEECH_QUALITY).toBe("dictation");
  });

  it("a instalacao usa a mesma consulta da sonda", async () => {
    // Divergir aqui instalaria o pacote de um perfil e reconheceria com outro.
    const spy = spyEnvironment("downloadable");
    await installLocalSpeech(spy.environment);
    expect(spy.installs[0]).toEqual(spy.queries[0]);
  });
});

describe("instalacao do pacote de idioma: explicita, e so quando ha o que instalar", () => {
  function environmentWith(
    answer: string,
    options: { install?: boolean | "absent" | Error } = {},
  ) {
    const { install = true } = options;
    let current = answer;
    const installs: unknown[] = [];

    const base = {
      available: () => Promise.resolve(current),
    } as Record<string, unknown>;

    if (install !== "absent") {
      base.install = (query: unknown) => {
        installs.push(query);
        if (install instanceof Error) throw install;
        if (install) current = "available";
        return Promise.resolve(install);
      };
    }

    const Recognition = Object.assign(function () {} as never, base);
    return {
      installs,
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
    };
  }

  it("F. downloadable nao inicia reconhecimento, e a instalacao fica disponivel", async () => {
    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "downloadable",
    });

    // O pacote existir nao e o pacote estar instalado.
    expect(state.starts).toBe(0);
    await expect(transcriber!.stop()).resolves.toEqual({
      status: "unavailable",
      reason: "local_speech_unavailable",
    });

    const env = environmentWith("downloadable");
    const outcome = await installLocalSpeech(env.environment);
    expect(outcome).toEqual({ status: "installed", availability: "available" });
  });

  it("G. unavailable nao chama install, e nao inicia reconhecimento", async () => {
    /*
      `unavailable` significa que **nao ha pacote** para este idioma neste
      navegador. Chamar `install()` ali fingiria a existencia de algo instalavel,
      e a falha voltaria como erro tecnico em vez da resposta que ja se tinha.
    */
    const env = environmentWith("unavailable");
    const outcome = await installLocalSpeech(env.environment);

    expect(env.installs).toHaveLength(0);
    expect(outcome).toEqual({ status: "refused", reason: "not_downloadable" });

    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "unavailable",
    });
    expect(state.starts).toBe(0);
  });

  it("H. depois de instalar, a sonda roda de novo e so entao o reconhecimento pode comecar", async () => {
    const env = environmentWith("downloadable");
    const outcome = await installLocalSpeech(env.environment);
    expect(outcome.status).toBe("installed");
    if (outcome.status !== "installed") return;

    /*
      Instalacao bem-sucedida **nao** e prova de que o reconhecimento sera local:
      ela pode ter ficado em `downloading`. Quem prova e a sonda, e por isso ela
      roda outra vez antes de qualquer `start()`.
    */
    expect(outcome.availability).toBe("available");

    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: outcome.availability,
    });
    expect(state.starts).toBe(1);
  });

  it("instalacao que termina em downloading nao autoriza iniciar", async () => {
    let current = "downloadable";
    const Recognition = Object.assign(function () {} as never, {
      available: () => Promise.resolve(current),
      install: () => {
        // O download comecou e nao terminou.
        current = "downloading";
        return Promise.resolve(true);
      },
    });
    const outcome = await installLocalSpeech({
      SpeechRecognition: Recognition,
    } as SpeechEnvironment);

    expect(outcome).toEqual({ status: "installed", availability: "downloading" });

    const { state, Recognition: Fake } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Fake } as SpeechEnvironment,
      localAvailability: "downloading",
    });
    expect(state.starts).toBe(0);
  });

  it("navegador sem install devolve recusa nomeada, e nao excecao", async () => {
    const env = environmentWith("downloadable", { install: "absent" });
    await expect(installLocalSpeech(env.environment)).resolves.toEqual({
      status: "refused",
      reason: "unsupported",
    });
  });

  it("install que estoura nao derruba a preparacao da sessao", async () => {
    const env = environmentWith("downloadable", {
      install: new Error("install_failed"),
    });
    await expect(installLocalSpeech(env.environment)).resolves.toEqual({
      status: "refused",
      reason: "failed",
    });
  });

  it("install que devolve false e recusa, e nao sucesso silencioso", async () => {
    const env = environmentWith("downloadable", { install: false });
    await expect(installLocalSpeech(env.environment)).resolves.toEqual({
      status: "refused",
      reason: "failed",
    });
  });
});

describe("ciclo de vida: o reconhecedor volta, a transcricao nao se perde", () => {
  const immediate = (handler: () => void) => handler();

  it("onend espontaneo reinicia o reconhecimento", () => {
    /*
      O defeito que custou a validacao fisica #1.

      `onend` dispara sozinho depois de silencio, mesmo com continuous = true.
      Sem reinicio, tres minutos de fala viravam zero palavras porque o navegador
      desistiu nos primeiros segundos.
    */
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
    });

    expect(state.starts).toBe(1);
    state.instance!.onend?.();
    expect(state.starts).toBe(2);
    state.instance!.onend?.();
    expect(state.starts).toBe(3);
  });

  it("o texto ja reconhecido sobrevive ao reinicio", async () => {
    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
      elapsedMs: () => 1000,
    })!;

    emitFinal(state.instance!, "primeira parte");
    state.instance!.onend?.();
    emitFinal(state.instance!, "segunda parte");

    const result = await transcriber.stop();
    expect(result.status).toBe("available");
    if (result.status === "available") {
      expect(result.text).toBe("primeira parte segunda parte");
    }
  });

  it("stop nao reinicia", async () => {
    const { state, Recognition } = fakeRecognition();
    const transcriber = startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
    })!;

    const before = state.starts;
    await transcriber.stop();
    expect(state.starts).toBe(before);
  });

  it("erro fatal nao cria laco de reinicio", () => {
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
    });

    state.instance!.onerror?.({ error: "not-allowed" });
    state.instance!.onend?.();
    state.instance!.onend?.();

    // Permissao negada nao melhora com insistencia.
    expect(state.starts).toBe(1);
  });

  it("no-speech transitorio nao e fatal e permite reinicio", () => {
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
    });

    // Silencio no meio de uma sessao e normal - e nao pode encerrar a captura
    // pelo resto dela.
    state.instance!.onerror?.({ error: "no-speech" });
    state.instance!.onend?.();
    expect(state.starts).toBe(2);
  });

  it("o reinicio tem teto", () => {
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule: immediate,
    });

    for (let index = 0; index < SPEECH_MAX_RESTARTS + 5; index += 1) {
      state.instance!.onend?.();
    }
    // Um `onend` imediato e repetido viraria laco queimando CPU e microfone.
    expect(state.starts).toBe(SPEECH_MAX_RESTARTS + 1);
  });

  it("o reinicio e adiado, e nao sincrono", () => {
    const schedule = vi.fn();
    const { state, Recognition } = fakeRecognition();
    startSessionTranscription({
      environment: { SpeechRecognition: Recognition } as SpeechEnvironment,
      localAvailability: "available",
      schedule,
    });

    state.instance!.onend?.();
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule.mock.calls[0]![1]).toBeGreaterThan(0);
  });
});

describe("ausencia de transcricao nao e ausencia de voz", () => {
  const semTexto = {
    status: "unavailable" as const,
    reason: "no_speech_detected" as const,
  };

  it("voz medida com reconhecedor vazio vira contradicao declarada", () => {
    /*
      A sessao fisica #1 mediu voz por mais de dois minutos e a tela disse
      "Nenhuma fala foi reconhecida durante a sessao" - uma afirmacao sobre a
      pessoa, feita a partir da fonte que falhou.
    */
    const submission = buildTranscriptSubmission(semTexto, 130_000, 137_000);
    expect(submission).toEqual({
      status: "unavailable",
      reason: "speech_detected_but_not_transcribed",
    });
  });

  it("silencio real continua sendo no_speech_detected", () => {
    const submission = buildTranscriptSubmission(semTexto, 0, 137_000);
    expect(submission).toEqual({
      status: "unavailable",
      reason: "no_speech_detected",
    });
  });

  it("ruido curto nao sustenta a contradicao sozinho", () => {
    // Abaixo do limiar, um tossido ou um clique poderiam afirmar fala.
    const submission = buildTranscriptSubmission(
      semTexto,
      VOICED_CONTRADICTION_MIN_MS - 1,
      137_000,
    );
    expect(submission).toEqual({
      status: "unavailable",
      reason: "no_speech_detected",
    });
  });

  it("motivos que ja nomeiam a causa nao sao sobrescritos", () => {
    for (const reason of [
      "speech_api_denied",
      "recognition_failed",
      "local_speech_unavailable",
    ] as const) {
      const submission = buildTranscriptSubmission(
        { status: "unavailable", reason },
        130_000,
        137_000,
      );
      // Trocar por `speech_detected_but_not_transcribed` apagaria a causa real.
      expect(submission, reason).toEqual({ status: "unavailable", reason });
    }
  });
});
