import { beforeEach, describe, expect, it } from "vitest";

import {
  NO_STORE_HEADERS,
  STATIC_SECURITY_HEADERS,
  buildContentSecurityPolicy,
  strictTransportSecurity,
} from "@/lib/security/headers";
import {
  RATE_LIMIT_RULES,
  consumeRateLimit,
  effectiveRateLimitRule,
  rateLimitIdentity,
  rateLimitedResponse,
  resetRateLimits,
  trustedClientIp,
  trustedProxyHops,
} from "@/lib/security/rate-limit";

const NONCE = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

function directive(policy: string, name: string): string {
  const found = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return found ?? "";
}

// ---------------------------------------------------------------------------
// Content Security Policy
// ---------------------------------------------------------------------------

describe("buildContentSecurityPolicy", () => {
  const supabaseUrl = "https://projeto.example.invalid";

  it("PRO-7R: abre connect-src so para o host de midia configurado", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl, realtimeUrl: "wss://midia.exemplo.org/rtc" });
    const connect = directive(policy, "connect-src");
    expect(connect).toContain("wss://midia.exemplo.org");
    expect(connect).toContain("https://midia.exemplo.org");
    for (const name of ["connect-src", "media-src", "frame-src", "img-src", "worker-src"]) {
      expect(directive(policy, name)).not.toContain("*");
    }
    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
    expect(directive(policy, "media-src")).not.toContain("wss://midia.exemplo.org");
  });

  it("PRO-7R: URL de midia invalida ou de outro esquema nao abre nada", () => {
    for (const realtimeUrl of ["", "nao-e-url", "https://midia.exemplo.org", "javascript:alert(1)"]) {
      const connect = directive(buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl, realtimeUrl }), "connect-src");
      expect(connect).not.toContain("midia.exemplo.org");
      expect(connect).not.toContain("javascript");
    }
  });

  it("usa nonce em script-src, sem unsafe-inline", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });
    const scripts = directive(policy, "script-src");

    expect(scripts).toContain(`'nonce-${NONCE}'`);
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it("nao permite eval fora de desenvolvimento", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(directive(policy, "script-src")).not.toContain("'unsafe-eval'");
  });

  it("permite eval apenas em desenvolvimento, para o HMR", () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      supabaseUrl,
      development: true,
    });

    expect(directive(policy, "script-src")).toContain("'unsafe-eval'");
  });

  it("bloqueia clickjacking e embedding", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(directive(policy, "frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(directive(policy, "frame-src")).toBe("frame-src 'none'");
    expect(directive(policy, "object-src")).toBe("object-src 'none'");
  });

  it("restringe form-action e base-uri a propria origem", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(directive(policy, "form-action")).toBe("form-action 'self'");
    expect(directive(policy, "base-uri")).toBe("base-uri 'self'");
  });

  it("libera blob: para a previa da captura multimodal", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(directive(policy, "media-src")).toContain("blob:");
    expect(directive(policy, "img-src")).toContain("blob:");
    expect(directive(policy, "worker-src")).toContain("blob:");
  });

  it("permite conectar somente ao Supabase configurado", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });
    const connect = directive(policy, "connect-src");

    expect(connect).toContain(supabaseUrl);
    expect(connect).toContain("wss://projeto.example.invalid");
    expect(connect).not.toContain("*");
  });

  it("nao inventa host quando a URL do Supabase e invalida", () => {
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      supabaseUrl: "nao-e-uma-url",
    });

    // So o host fixo do mapa (SUP-2, provider central); nenhum host de Supabase inventado.
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org");
  });

  it("nao inventa host quando a URL do Supabase esta ausente", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE });

    // So o host fixo do mapa (SUP-2, provider central); nenhum host de Supabase inventado.
    expect(directive(policy, "connect-src")).toBe("connect-src 'self' https://tiles.openfreemap.org");
  });

  it("promove requisicoes quando todo o backend ja e https", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(policy).toContain("upgrade-insecure-requests");
  });

  it("nao promove requisicoes quando o proprio Supabase e http local", () => {
    // Regressao: `next start` roda em modo producao tambem no QA local. Promover
    // http://127.0.0.1:54381 para https derrubaria toda a persistencia.
    const policy = buildContentSecurityPolicy({
      nonce: NONCE,
      supabaseUrl: "http://127.0.0.1:54381",
    });

    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("default-src fecha o que nao foi declarado", () => {
    const policy = buildContentSecurityPolicy({ nonce: NONCE, supabaseUrl });

    expect(directive(policy, "default-src")).toBe("default-src 'self'");
  });
});

// ---------------------------------------------------------------------------
// Cabecalhos estaticos
// ---------------------------------------------------------------------------

describe("STATIC_SECURITY_HEADERS", () => {
  it("nega enquadramento e sniffing", () => {
    expect(STATIC_SECURITY_HEADERS["X-Frame-Options"]).toBe("DENY");
    expect(STATIC_SECURITY_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });

  it("nao vaza caminho completo para outra origem", () => {
    expect(STATIC_SECURITY_HEADERS["Referrer-Policy"]).toBe(
      "strict-origin-when-cross-origin",
    );
  });

  it("libera camera, microfone e captura de tela para a propria origem", () => {
    // Hardening nao pode quebrar o multimodal: estes tres SAO produto da V1.
    const policy = STATIC_SECURITY_HEADERS["Permissions-Policy"];

    expect(policy).toContain("camera=(self)");
    expect(policy).toContain("microphone=(self)");
    expect(policy).toContain("display-capture=(self)");
  });

  it("nega nominalmente o que a V1 nao usa", () => {
    const policy = STATIC_SECURITY_HEADERS["Permissions-Policy"];

    for (const denied of [
      "payment=()",
      "usb=()",
      "serial=()",
      "hid=()",
      "midi=()",
      "browsing-topics=()",
    ]) {
      expect(policy).toContain(denied);
    }
  });
});

describe("SUP-2 (ADR-0032): localizacao e mapa da Rede de Apoio", () => {
  it("libera geolocalizacao so para a propria origem, nunca para terceiros", () => {
    const policy = STATIC_SECURITY_HEADERS["Permissions-Policy"];
    expect(policy).toContain("geolocation=(self)");
    expect(policy).not.toContain("geolocation=()");
    expect(policy).not.toMatch(/geolocation=\*|geolocation=\(self [^)]/);
  });

  it("CSP abre so o host do provider de mapa em connect-src; nada generico", () => {
    const csp = buildContentSecurityPolicy({ nonce: "n" });
    const directive = (name: string) => csp.split("; ").find((part) => part.startsWith(`${name} `)) ?? "";
    expect(directive("connect-src")).toContain("https://tiles.openfreemap.org");
    expect(directive("img-src")).not.toContain("openfreemap");
    expect(directive("worker-src")).toBe("worker-src 'self' blob:");
    for (const name of ["connect-src", "img-src", "worker-src", "script-src"]) {
      expect(directive(name)).not.toMatch(/(^| )\*( |$)|https:( |$)/);
    }
    expect(csp).not.toContain("tile.openstreetmap.org");
  });
});

describe("strictTransportSecurity", () => {
  it("emite HSTS somente sobre https", () => {
    expect(strictTransportSecurity("https:")).toContain("max-age=");
  });

  it("nunca emite HSTS sobre http", () => {
    // Emitir em http local ensinaria o navegador a exigir TLS de localhost.
    expect(strictTransportSecurity("http:")).toBeNull();
  });
});

describe("NO_STORE_HEADERS", () => {
  it("impede cache compartilhado de resposta com dado pessoal", () => {
    expect(NO_STORE_HEADERS["Cache-Control"]).toContain("no-store");
    expect(NO_STORE_HEADERS["Cache-Control"]).toContain("private");
  });
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

describe("consumeRateLimit", () => {
  beforeEach(() => resetRateLimits());

  it("permite ate o limite da janela", () => {
    const rule = RATE_LIMIT_RULES.auth;
    for (let index = 0; index < rule.limit; index += 1) {
      expect(consumeRateLimit("auth", "ip:1.2.3.4").allowed).toBe(true);
    }
  });

  it("bloqueia a requisicao seguinte", () => {
    const rule = RATE_LIMIT_RULES.auth;
    for (let index = 0; index < rule.limit; index += 1) {
      consumeRateLimit("auth", "ip:1.2.3.4");
    }
    const blocked = consumeRateLimit("auth", "ip:1.2.3.4");

    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("libera quando a janela expira", () => {
    const rule = RATE_LIMIT_RULES.auth;
    const start = 1_000_000;
    for (let index = 0; index < rule.limit; index += 1) {
      consumeRateLimit("auth", "ip:1.2.3.4", start);
    }
    expect(consumeRateLimit("auth", "ip:1.2.3.4", start).allowed).toBe(false);
    expect(
      consumeRateLimit("auth", "ip:1.2.3.4", start + rule.windowMs + 1).allowed,
    ).toBe(true);
  });

  it("isola identidades diferentes", () => {
    const rule = RATE_LIMIT_RULES.auth;
    for (let index = 0; index < rule.limit; index += 1) {
      consumeRateLimit("auth", "ip:1.1.1.1");
    }

    expect(consumeRateLimit("auth", "ip:1.1.1.1").allowed).toBe(false);
    expect(consumeRateLimit("auth", "ip:2.2.2.2").allowed).toBe(true);
  });

  it("isola escopos diferentes", () => {
    const rule = RATE_LIMIT_RULES.subjectExport;
    for (let index = 0; index < rule.limit; index += 1) {
      consumeRateLimit("subjectExport", "user:abc");
    }

    expect(consumeRateLimit("subjectExport", "user:abc").allowed).toBe(false);
    expect(consumeRateLimit("accountDeletion", "user:abc").allowed).toBe(true);
  });

  it("exportacao e exclusao tem limites deliberadamente baixos", () => {
    expect(RATE_LIMIT_RULES.subjectExport.limit).toBeLessThanOrEqual(5);
    expect(RATE_LIMIT_RULES.accountDeletion.limit).toBeLessThanOrEqual(5);
  });

  it("cobre todos os escopos sensiveis do mandato", () => {
    /*
      `passwordRecovery` nasceu no 23-D e ficou **fora** desta lista ate o 23-E.
      A omissao nao quebrou nada — e esse e o problema: uma guarda de completude
      que nao conhece o escopo novo passa a nao guardar nada sobre ele. Mesma
      familia da tabela que ficou sem classificacao no registro do export.
    */
    for (const scope of [
      "auth",
      "passwordRecovery",
      "passwordReset",
      "consentAccept",
      "notificationPreference",
      "oauthCallback",
      "pedrocore",
      "learning",
      "signedUrl",
      "upload",
      "subjectExport",
      "accountDeletion",
      "professionalInvite",
      "professionalReview",
      "professionalInviteRedeem",
      "professionalDirectory",
      "passwordRecoveryRecipient",
      "notificationDispatch",
      "schedulingWrite",
      "schedulingRead",
      "supportNetworkRead",
      "sessionAccess",
      "sessionMedia",
      "connectionRequest",
      "professionalOnboardingSubmit",
      "helpRequestWrite",
    ] as const) {
      expect(RATE_LIMIT_RULES[scope].limit).toBeGreaterThan(0);
      expect(RATE_LIMIT_RULES[scope].windowMs).toBeGreaterThan(0);
    }
  });

  it("a lista acima cobre TODOS os escopos declarados", () => {
    /*
      A guarda da guarda. Enumerar a mao protege contra esquecer de verificar um
      escopo; comparar com as chaves reais protege contra esquecer de enumerar.
      Sem isto, o proximo balde novo repetiria exatamente o que aconteceu com
      `passwordRecovery`.
    */
    const declarados = Object.keys(RATE_LIMIT_RULES).sort();
    const verificados = [
      "auth",
      "passwordRecovery",
      "passwordReset",
      "consentAccept",
      "notificationPreference",
      "oauthCallback",
      "pedrocore",
      "learning",
      "signedUrl",
      "upload",
      "subjectExport",
      "accountDeletion",
      "professionalInvite",
      "professionalReview",
      "professionalInviteRedeem",
      "professionalDirectory",
      "passwordRecoveryRecipient",
      "notificationDispatch",
      "schedulingWrite",
      "schedulingRead",
      "sessionAccess",
      "sessionMedia",
      "connectionRequest",
      "professionalOnboardingSubmit",
      "helpRequestWrite",
      "supportNetworkRead",
    ].sort();
    expect(declarados).toEqual(verificados);
  });

  it("recuperacao e redefinicao nao dividem o mesmo balde", () => {
    // Custos diferentes: uma dispara e-mail para a caixa de terceiro, a outra
    // tenta trocar credencial. Contador compartilhado erraria com as duas.
    const rule = RATE_LIMIT_RULES.passwordRecovery;
    for (let index = 0; index < rule.limit; index += 1) {
      consumeRateLimit("passwordRecovery", "ip:9.9.9.9");
    }

    expect(consumeRateLimit("passwordRecovery", "ip:9.9.9.9").allowed).toBe(false);
    expect(consumeRateLimit("passwordReset", "ip:9.9.9.9").allowed).toBe(true);
  });
});

describe("rateLimitIdentity", () => {
  it("prefere o usuario autenticado", () => {
    expect(rateLimitIdentity("abc", "1.2.3.4")).toBe("user:abc");
  });

  it("sem proxy: o unico item e o IP do socket que o Next preencheu", () => {
    expect(rateLimitIdentity(null, "1.2.3.4", {})).toBe("ip:1.2.3.4");
  });

  it("L-427: le da direita — o IP que a borda confiavel acrescentou, nao o que o cliente mandou", () => {
    // Cliente forja "9.9.9.9"; a borda acrescenta o IP real (5.6.7.8).
    expect(rateLimitIdentity(null, "9.9.9.9, 5.6.7.8", {})).toBe("ip:5.6.7.8");
    // Trocar o valor forjado nao troca de balde.
    expect(rateLimitIdentity(null, "1.1.1.1, 5.6.7.8", {})).toBe(rateLimitIdentity(null, "2.2.2.2, 5.6.7.8", {}));
  });

  it("dois proxies confiaveis declarados: pula o ultimo salto", () => {
    const env = { ELYRA_TRUSTED_PROXY_HOPS: "2" };
    expect(rateLimitIdentity(null, "9.9.9.9, 5.6.7.8, 10.0.0.2", env)).toBe("ip:5.6.7.8");
    // Lista menor que os saltos: tudo veio de proxy; usa o mais proximo do cliente.
    expect(rateLimitIdentity(null, "5.6.7.8", env)).toBe("ip:5.6.7.8");
  });

  it("saltos ilegiveis voltam ao padrao 1, nunca desligam a regra", () => {
    for (const value of ["0", "-1", "abc", "6", "1.5", ""]) {
      expect(trustedProxyHops({ ELYRA_TRUSTED_PROXY_HOPS: value })).toBe(1);
    }
  });

  it("valor que nao parece IP nao vira chave de balde", () => {
    expect(rateLimitIdentity(null, "1.2.3.4, <script>", {})).toBe("anonymous");
    expect(trustedClientIp("2001:db8::1", 1)).toBe("2001:db8::1");
    expect(trustedClientIp(" , ", 1)).toBeNull();
  });

  it("fail-closed sem usuario e sem IP", () => {
    // Todos os anonimos sem IP compartilham o mesmo balde, de proposito.
    expect(rateLimitIdentity(null, null)).toBe("anonymous");
  });
});

describe("rateLimitedResponse", () => {
  it("responde 429 com Retry-After e sem cache", () => {
    const response = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 42,
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("nao revela contadores internos", async () => {
    const response = rateLimitedResponse({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 5,
    });
    const body = (await response.json()) as Record<string, unknown>;

    expect(Object.keys(body)).toEqual(["error"]);
  });
});

describe("same-NAT: balde de autenticacao em QA declarado", () => {
  const base = RATE_LIMIT_RULES.auth;

  it("fora de QA, vale o limite de producao", () => {
    expect(effectiveRateLimitRule("auth", { ELYRA_QA_GROUP_SIZE: "12" })).toEqual(base);
    expect(
      effectiveRateLimitRule("auth", {
        ELYRA_RUNTIME_ENV: "production",
        ELYRA_QA_GROUP_SIZE: "12",
      }),
    ).toEqual(base);
  });

  it("em QA sem tamanho declarado, vale o limite de producao", () => {
    // Fail-closed: as duas condicoes precisam valer ao mesmo tempo. Um ambiente
    // de QA nao afrouxa nada sozinho.
    expect(effectiveRateLimitRule("auth", { ELYRA_RUNTIME_ENV: "qa" })).toEqual(base);
  });

  it("em QA com grupo declarado, o balde escala e a janela nao muda", () => {
    const rule = effectiveRateLimitRule("auth", {
      ELYRA_RUNTIME_ENV: "qa",
      ELYRA_QA_GROUP_SIZE: "12",
    });
    expect(rule.limit).toBe(base.limit * 12);
    // A janela e o que da sentido ao limite; escalar tempo seria mudar a
    // protecao, nao adapta-la ao grupo.
    expect(rule.windowMs).toBe(base.windowMs);
  });

  it("tamanho absurdo, negativo ou nao inteiro cai para producao", () => {
    for (const size of ["0", "1", "-5", "999", "12.5", "doze", ""]) {
      expect(
        effectiveRateLimitRule("auth", {
          ELYRA_RUNTIME_ENV: "qa",
          ELYRA_QA_GROUP_SIZE: size,
        }),
      ).toEqual(base);
    }
  });

  it("apenas o balde pre-autenticacao escala", () => {
    // Os demais escopos ja chaveiam por `user:<id>` e nao sofrem com NAT.
    // Escala-los seria afrouxar sem que exista o problema que justifica.
    const qa = { ELYRA_RUNTIME_ENV: "qa", ELYRA_QA_GROUP_SIZE: "12" };
    for (const scope of ["subjectExport", "accountDeletion", "upload", "signedUrl"] as const) {
      expect(effectiveRateLimitRule(scope, qa)).toEqual(RATE_LIMIT_RULES[scope]);
    }
  });
});
