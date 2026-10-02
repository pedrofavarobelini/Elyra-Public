import { describe, expect, it } from "vitest";

import {
  qaAllowedOrigins,
  serverActionsConfig,
} from "@/lib/security/server-actions-origins";

const HOST = "elyra-qa.trycloudflare.com";


describe("qaAllowedOrigins", () => {
  it("QA declarado com host configurado libera exatamente aquele host", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: HOST,
      }),
    ).toEqual([HOST]);
  });

  it("aceita varios hosts separados por virgula", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: ` ${HOST} , outro-tunel.example.com `,
      }),
    ).toEqual([HOST, "outro-tunel.example.com"]);
  });

  it("aceita host com porta", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: "127.0.0.1:3100",
      }),
    ).toEqual(["127.0.0.1:3100"]);
  });

  // --- Separacao de ambientes ---------------------------------------------

  it("PRODUCAO nunca herda a lista, mesmo com a variavel preenchida", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "production",
        ELYRA_QA_ALLOWED_ORIGINS: HOST,
      }),
    ).toEqual([]);
  });

  it("STAGING nunca herda a lista", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "staging",
        ELYRA_QA_ALLOWED_ORIGINS: HOST,
      }),
    ).toEqual([]);
  });

  it("DESENVOLVIMENTO nunca herda a lista", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "development",
        ELYRA_QA_ALLOWED_ORIGINS: HOST,
      }),
    ).toEqual([]);
  });

  it("ambiente ausente nao libera nada", () => {
    expect(qaAllowedOrigins({ ELYRA_QA_ALLOWED_ORIGINS: HOST })).toEqual([]);
  });

  it("QA sem hosts configurados nao libera nada", () => {
    expect(qaAllowedOrigins({ ELYRA_RUNTIME_ENV: "qa" })).toEqual([]);
  });

  it("ambiente totalmente vazio nao libera nada", () => {
    expect(qaAllowedOrigins({})).toEqual([]);
  });

  // --- Formato do host -----------------------------------------------------

  it("recusa curinga, que aceitaria qualquer tunel", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: "*.trycloudflare.com",
      }),
    ).toEqual([]);
  });

  it("recusa host com esquema", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: `https://${HOST}`,
      }),
    ).toEqual([]);
  });

  it("recusa host com caminho", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: `${HOST}/admin`,
      }),
    ).toEqual([]);
  });

  it("recusa porta nao numerica", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: `${HOST}:abc`,
      }),
    ).toEqual([]);
  });

  it("descarta o host invalido e mantem o valido", () => {
    expect(
      qaAllowedOrigins({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: `*.mau.com,${HOST}`,
      }),
    ).toEqual([HOST]);
  });
});

describe("serverActionsConfig", () => {
  it("em QA devolve a configuracao com as origens", () => {
    expect(
      serverActionsConfig({
        ELYRA_RUNTIME_ENV: "qa",
        ELYRA_QA_ALLOWED_ORIGINS: HOST,
      }),
    ).toEqual({
      experimental: { serverActions: { allowedOrigins: [HOST] } },
    });
  });

  it("fora do QA a chave nem existe na configuracao", () => {
    // Lista vazia explicita ainda seria configuracao presente; o objetivo e a
    // ausencia da chave.
    const config = serverActionsConfig({
      ELYRA_RUNTIME_ENV: "production",
      ELYRA_QA_ALLOWED_ORIGINS: HOST,
    });

    expect(config).toEqual({});
    expect("experimental" in config).toBe(false);
  });

  it("QA sem hosts tambem nao cria a chave", () => {
    expect(serverActionsConfig({ ELYRA_RUNTIME_ENV: "qa" })).toEqual({});
  });
});
