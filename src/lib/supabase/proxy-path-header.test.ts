// @vitest-environment node

import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { REQUEST_PATH_HEADER } from "@/lib/security/request-path";

/**
 * O proxy publica o caminho da requisicao — e ignora o que o cliente mandar.
 *
 * ## Por que este arquivo existe separado
 *
 * O portao de consentimento devolve a pessoa ao destino original depois do
 * aceite, e a unica fonte desse destino e este header. Se o navegador pudesse
 * escolher o valor, ele escolheria para onde a Elyra manda alguem depois de
 * autenticar — que e a definicao de open redirect, so que pela porta de dentro.
 *
 * A defesa tem **duas** metades, e uma so nao basta:
 *
 * 1. o proxy sobrescreve o header a cada requisicao — provado aqui;
 * 2. quem consome passa o valor por `safeInternalPath` — provado em
 *    `consent-gate.test.ts`.
 *
 * ## Por que a assercao nao procura o nome interno do Next
 *
 * O Next propaga headers de requisicao sobrescritos por um cabecalho proprio,
 * cujo nome e detalhe de implementacao. Procurar por ele seria testar a versao
 * do framework. O que se afirma aqui e a **propriedade**: o valor forjado nao
 * sobrevive em lugar nenhum da resposta, e o caminho real sobrevive.
 */

/** Sem credenciais, `updateSession` toma o ramo curto — e ainda assim publica o header. */
function semSupabase() {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "");
}

function valoresDaResposta(response: Response): string {
  return [...response.headers.entries()].map(([n, v]) => `${n}=${v}`).join("\n");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cabecalho interno de caminho", () => {
  it("publica o caminho real da requisicao", async () => {
    semSupabase();
    const { updateSession } = await import("./proxy");

    const response = await updateSession(
      new NextRequest("http://127.0.0.1:3000/sessoes"),
    );

    expect(valoresDaResposta(response)).toContain("/sessoes");
  });

  it("ignora o valor que o cliente tentou impor", async () => {
    semSupabase();
    const { updateSession } = await import("./proxy");

    const response = await updateSession(
      new NextRequest("http://127.0.0.1:3000/sessoes", {
        headers: { [REQUEST_PATH_HEADER]: "https://elyra-falso.example/roubar" },
      }),
    );

    const tudo = valoresDaResposta(response);
    expect(tudo, "o destino forjado sobreviveu ao proxy").not.toContain(
      "elyra-falso",
    );
    expect(tudo).toContain("/sessoes");
  });

  it("um segundo valor forjado tambem nao se acumula", async () => {
    /*
      `set` substitui; `append` acumularia. A diferenca importa: com dois valores
      no mesmo header, quem le pega o primeiro — que seria o do atacante.
    */
    semSupabase();
    const { updateSession } = await import("./proxy");

    const headers = new Headers();
    headers.append(REQUEST_PATH_HEADER, "//elyra-falso.example");
    headers.append(REQUEST_PATH_HEADER, "/\\elyra-falso.example");

    const response = await updateSession(
      new NextRequest("http://127.0.0.1:3000/diario", { headers }),
    );

    expect(valoresDaResposta(response)).not.toContain("elyra-falso");
  });
});
