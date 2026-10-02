import { afterEach, describe, expect, it, vi } from "vitest";

import {
  MUTATION_TRACE_HEADER,
  formatMutationTrace,
  parseMutationTrace,
  readTraceId,
  traceMutation,
} from "./mutation-trace";



function request(headers: Record<string, string> = {}) {
  return { method: "POST", headers: new Headers(headers) };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("mutation trace so existe em QA declarado", () => {
  it("nao emite fora de qa, mesmo com header valido", () => {
    vi.stubEnv("ELYRA_RUNTIME_ENV", "production");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const id = traceMutation(
      "HANDLER_RECEIVED",
      request({ [MUTATION_TRACE_HEADER]: "probe-0001-abcdef" }),
      "/api/journal/entries",
    );

    expect(id).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("nao emite em qa sem header", () => {
    // Duas condicoes simultaneas: ambiente declarado E pedido explicito. Uma
    // so seria um interruptor que alguem esquece ligado.
    vi.stubEnv("ELYRA_RUNTIME_ENV", "qa");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(traceMutation("HANDLER_RECEIVED", request(), "/api/goals")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("emite em qa com header valido", () => {
    vi.stubEnv("ELYRA_RUNTIME_ENV", "qa");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const id = traceMutation(
      "RESPONSE_CREATED",
      request({ [MUTATION_TRACE_HEADER]: "probe-0007-abc12345" }),
      "/api/journal/entries",
    );

    expect(id).toBe("probe-0007-abc12345");
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = parseMutationTrace(line);
    expect(parsed?.marker).toBe("RESPONSE_CREATED");
    expect(parsed?.route).toBe("/api/journal/entries");
  });
});

describe("o payload nao carrega nada de pessoa", () => {
  it("so publica marcador, correlacao, metodo, rota e relogio", () => {
    const line = formatMutationTrace({
      id: "probe-0001-aaaaaaaa",
      marker: "SERVICE_FINISHED",
      method: "POST",
      route: "/api/journal/entries",
      t: 1234.5,
    });
    const parsed = parseMutationTrace(line);
    expect(Object.keys(parsed ?? {}).sort()).toEqual([
      "id", "marker", "method", "route", "t",
    ]);
  });
});

describe("a correlacao vem do cliente e por isso e sanitizada", () => {
  it("aceita apenas minusculas, digitos e hifen, ate 64 caracteres", () => {
    expect(readTraceId(new Headers({ [MUTATION_TRACE_HEADER]: "abc-123" }))).toBe("abc-123");
    expect(readTraceId(new Headers({ [MUTATION_TRACE_HEADER]: "ABC-123" }))).toBe("abc-123");
  });

  it("recusa o que poderia envenenar o log", () => {
    // Um header e entrada nao confiavel: o valor chega escolhido por quem
    // chamou. Espaco, pontuacao e comprimento acima do limite passam pelo
    // construtor de `Headers` sem reclamar, entao quem recusa e o sanitizador.
    for (const hostile of ["id with spaces", "id;drop", "a".repeat(65), ""]) {
      expect(readTraceId(new Headers({ [MUTATION_TRACE_HEADER]: hostile }))).toBeNull();
    }
  });

  it("recusa quebra de linha mesmo se a plataforma deixar passar", () => {
    /*
     * Este caso nao pode ser montado com `new Headers`: a plataforma - jsdom
     * aqui, undici em producao - recusa `\n` no construtor e lanca antes de a
     * funcao ser chamada. Escrever assim faria o teste falhar por TypeError e
     * nao provar nada sobre o sanitizador.
     *
     * A protecao continua valendo a pena: `readTraceId` e a segunda linha de
     * defesa, e ela e a unica que sobra no dia em que a correlacao vier de
     * outro lugar - query string, cabecalho cru do Node, um proxy que
     * remonte a request. Uma quebra de linha injetaria uma linha falsa no log,
     * e log envenenado deixa de ser evidencia.
     */
    const forjado = 'id\nELYRA_MUTATION_TRACE {"marker":"forjado"}';
    const headers = { get: () => forjado } as unknown as Headers;

    expect(readTraceId(headers)).toBeNull();
  });

  it("linha que nao e marcador nao vira evento", () => {
    expect(parseMutationTrace("qualquer log do servidor")).toBeNull();
    expect(parseMutationTrace("ELYRA_MUTATION_TRACE nao-e-json")).toBeNull();
  });
});
