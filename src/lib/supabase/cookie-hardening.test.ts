import { describe, expect, it } from "vitest";

import { hardenAuthCookie, isSecureRequest } from "@/lib/supabase/cookie-hardening";

/**
 * O cookie de sessao chegava ao Android com `httpOnly=false` e `secure=false`.
 *
 * Estes testes travam as duas decisoes: o token deixa de ser legivel por script
 * na pagina, e `Secure` acompanha o transporte em vez de ficar sempre ligado ou
 * sempre desligado.
 */

describe("deteccao de HTTPS", () => {
  it("HTTPS direto liga", () => {
    expect(isSecureRequest({ protocol: "https:" })).toBe(true);
  });

  it("HTTP de localhost nao liga", () => {
    /*
      Se ligasse, `Secure` faria o navegador recusar o cookie em
      `http://localhost` e o desenvolvimento pararia de autenticar - com um
      sintoma que parece bug de login.
    */
    expect(isSecureRequest({ protocol: "http:" })).toBe(false);
  });

  it("atras de proxy, `x-forwarded-proto` decide", () => {
    /*
      O tunel termina o TLS e fala HTTP com a aplicacao. Sem ler este header, a
      homologacao HTTPS receberia cookie sem `Secure`.
    */
    expect(isSecureRequest({ protocol: "http:", forwardedProto: "https" })).toBe(true);
    expect(isSecureRequest({ protocol: "https:", forwardedProto: "http" })).toBe(false);
  });

  it("cadeia de proxies usa o primeiro salto", () => {
    // `https, http` significa que o cliente veio por HTTPS.
    expect(isSecureRequest({ protocol: "http:", forwardedProto: "https, http" })).toBe(true);
    expect(isSecureRequest({ protocol: "http:", forwardedProto: " HTTPS ,http" })).toBe(true);
  });

  it("ausencia de informacao nao liga", () => {
    // Fail-closed para o lado que nao quebra: sem prova de HTTPS, sem `Secure`.
    expect(isSecureRequest({})).toBe(false);
    expect(isSecureRequest({ protocol: null, forwardedProto: null })).toBe(false);
    expect(isSecureRequest({ forwardedProto: "" })).toBe(false);
  });
});

describe("endurecimento do cookie", () => {
  it("liga `httpOnly` sempre", () => {
    expect(hardenAuthCookie({}, false).httpOnly).toBe(true);
    expect(hardenAuthCookie({}, true).httpOnly).toBe(true);
    // Mesmo quando a biblioteca pede explicitamente o contrario.
    expect(hardenAuthCookie({ httpOnly: false }, true).httpOnly).toBe(true);
  });

  it("`secure` segue o transporte", () => {
    expect(hardenAuthCookie({}, true).secure).toBe(true);
    expect(hardenAuthCookie({}, false).secure).toBe(false);
    expect(hardenAuthCookie({ secure: true }, false).secure).toBe(false);
  });

  it("preserva tudo o que nao e `httpOnly` nem `secure`", () => {
    const hardened = hardenAuthCookie(
      { maxAge: 3600, path: "/app", sameSite: "strict", domain: "elyra.example" },
      true,
    );
    expect(hardened.maxAge).toBe(3600);
    expect(hardened.path).toBe("/app");
    expect(hardened.sameSite).toBe("strict");
    expect(hardened.domain).toBe("elyra.example");
  });

  it("sem `path`, a sessao vale para o site inteiro", () => {
    /*
      Um cookie de sessao sem `path` fica preso ao diretorio da requisicao que o
      criou: `/entrar` criaria uma sessao que `/dashboard` nao enxerga.
    */
    expect(hardenAuthCookie({}, true).path).toBe("/");
    expect(hardenAuthCookie(undefined, true).path).toBe("/");
  });

  it("sem `sameSite`, cai em `lax`", () => {
    expect(hardenAuthCookie({}, true).sameSite).toBe("lax");
  });

  it("nunca devolve `httpOnly=false` nem `secure=true` em HTTP", () => {
    // Teste negativo: as duas regressoes que a auditoria apontaria de novo.
    for (const options of [{}, { httpOnly: false }, { secure: true }, undefined]) {
      expect(hardenAuthCookie(options, false).httpOnly).not.toBe(false);
      expect(hardenAuthCookie(options, false).secure).not.toBe(true);
    }
  });
});
