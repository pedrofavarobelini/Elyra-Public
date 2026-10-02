import { randomUUID } from "node:crypto";

try { process.loadEnvFile?.(".env.local"); } catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
}



const baseUrl = process.env.PROBE_BASE_URL ?? "http://127.0.0.1:3210";

if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(baseUrl)) {
  console.error("SECURITY_PROBE=BLOCKED reason=target_must_be_localhost");
  process.exit(1);
}

const findings = [];
let checks = 0;

function record(id, passed, detail) {
  checks += 1;
  if (!passed) findings.push({ id, detail });
}

async function probe(path, init = {}) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", ...init });
}

/** Rotas de API que exigem sessao. */
const AUTHENTICATED_ROUTES = [
  "/api/me/profile",
  "/api/me/profile/photo",
  "/api/me/preferences",
  "/api/me/export",
  "/api/me/account",
  "/api/emotional/checkins",
  "/api/emotional/sleep",
  "/api/journal/entries",
  "/api/goals",
  "/api/cycle/data",
  "/api/cycle/periods",
  "/api/reports/snapshots",
  "/api/reports/insights",
  "/api/multimodal/sessions",
  "/api/multimodal/assets",
  "/api/professional/connections",
  "/api/professional/permissions",
  "/api/professional/notes",

  "/api/professional/verification",
  "/api/professional/review",
  "/api/professional/invites",
  "/api/professional/invites/redeem",
  "/api/professional/permissions/validity",
  "/api/professional/access-log",
  "/api/professional/profile",

  "/api/professional/public-profile",

  "/api/professional/onboarding",
  "/api/professional/credentials?id=00000000-0000-4000-8000-000000000000",
  "/api/professional/review/credentials",

  // sao rotas autenticadas novas e precisam ser sondadas como as demais.
  "/api/notifications",
  "/api/notifications/00000000-0000-4000-8000-000000000000",

  "/api/professional/connection-requests",

  "/api/scheduling/availability",
  // UX F6: excecoes da agenda (abertura, bloqueio, conflito).
  "/api/scheduling/availability/exceptions",
  "/api/scheduling/availability/exceptions/00000000-0000-4000-8000-000000000000",
  "/api/scheduling/slots?professional=00000000-0000-4000-8000-000000000000&from=2026-10-01T00:00:00Z&to=2026-10-08T00:00:00Z",
  "/api/scheduling/appointments",
  "/api/scheduling/appointments/00000000-0000-4000-8000-000000000000",

  "/api/professional-sessions",
  "/api/professional-sessions/00000000-0000-4000-8000-000000000000",
  "/api/professional-sessions/00000000-0000-4000-8000-000000000000/consents",
  "/api/professional-sessions/00000000-0000-4000-8000-000000000000/transcript",

  "/api/professional-sessions/00000000-0000-4000-8000-000000000000/media",

  "/api/help-requests",
  "/api/help-requests/00000000-0000-4000-8000-000000000000",
  // SUP-2: busca da Rede de Apoio (so POST; o POST anonimo e sondado abaixo).
  "/api/support/facilities/search",
];

/** Paginas privadas que nao podem renderizar para anonimo. */
const PRIVATE_PAGES = [
  "/dashboard",
  "/meu-humor",
  "/historico",
  "/diario",
  "/metas",
  "/ciclo",
  "/relatorios",
  "/sessoes",
  "/configuracoes",
  "/perfil",
  "/pro/dashboard",
  "/pro/pacientes",
  "/pro/perfil",
  "/convite",

  "/pro/acompanhamentos",
  "/pro/relatorios",
  "/pro/solicitacoes",
  "/pro/vinculos",

  "/profissionais",
  "/profissionais/aaaaaaaaaaaa0001",

  "/agenda",
  "/pro/agenda",
  "/pro/sessoes",
  "/pro/sessoes/00000000-0000-4000-8000-000000000000",
  "/agenda/sessao/00000000-0000-4000-8000-000000000000",

  "/pedidos",
  "/pro/pedidos",
  // SUP-2: Rede de Apoio e autenticada (D-SUP-9).
  "/rede-de-apoio",
  // SUP-3: Conteudos de Apoio tambem (app autenticado; sem API nova).
  "/conteudos-de-apoio",
  "/conteudos-de-apoio/rede-de-atencao-psicossocial",
];

let failure;

try {
  // =======================================================================
  // 1. Auth bypass — anonimo nao alcanca dado privado
  // =======================================================================

  for (const route of AUTHENTICATED_ROUTES) {
    const response = await probe(route);
    const body = await response.text();
    record(
      `auth_bypass:${route}`,
      response.status === 401 ||
        response.status === 405 ||
        response.status === 404 ||
        response.status >= 300,
      `status=${response.status}`,
    );
    // Mesmo recusando, a resposta nao pode conter dado de dominio.
    record(
      `auth_leak:${route}`,
      !/"(display_name|email|body|content|payload|transcript)"/.test(body),
      "corpo da recusa carrega campo de dominio",
    );
  }

  for (const page of PRIVATE_PAGES) {
    const response = await probe(page);
    const isRedirect = response.status >= 300 && response.status < 400;
    const body = isRedirect ? "" : await response.text();
    record(
      `private_page:${page}`,
      isRedirect || !body.includes("Sair da conta"),
      `status=${response.status}`,
    );
  }

  // SUP-2: POST anonimo na busca da Rede de Apoio, com corpo normal, com
  // coordenada e com injecao — sempre 401, nunca dado nem 500.
  for (const [label, body] of [
    ["normal", { municipalityCode: "355030" }],
    ["coordenada", { municipalityCode: "355030", latitude: -23.5, longitude: -46.6 }],
    ["injecao", { municipalityCode: "355030' OR 1=1--", officialTypeCode: "<script>" }],
  ]) {
    const response = await probe("/api/support/facilities/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    record(
      `auth_bypass:support_search:${label}`,
      response.status === 401 && !/cnes|officialType|facilities/.test(text),
      `status=${response.status}`,
    );
  }

  // =======================================================================
  // 2. IDOR — identificador de terceiro nao vira acesso
  // =======================================================================

  const foreignId = randomUUID();
  for (const route of [
    `/api/multimodal/sessions/${foreignId}`,
    `/api/multimodal/assets/${foreignId}/signed-url`,
    `/api/professional/patients/${foreignId}`,
    // PRO-7R: UUID sozinho nunca emite token de midia nem chave E2EE.
    `/api/professional-sessions/${foreignId}/media`,
  ]) {
    const response = await probe(route, { method: "POST" });
    record(
      `idor:${route}`,
      response.status === 401 || response.status >= 400,
      `status=${response.status}`,
    );
  }

  // =======================================================================
  // 3. Injecao e id malformado — recusa limpa, sem erro interno vazado
  // =======================================================================

  const malformed = [
    "' OR 1=1--",
    "../../etc/passwd",
    "%2e%2e%2f%2e%2e%2f",
    "<script>alert(1)</script>",
    "\u0000null",
    "9999999999999999999999",
  ];
  for (const value of malformed) {
    const response = await probe(
      `/api/multimodal/sessions/${encodeURIComponent(value)}`,
    );
    const body = await response.text();
    record(
      `malformed:${value.slice(0, 16)}`,
      response.status >= 400,
      `status=${response.status}`,
    );
    // Stack trace, nome de tabela ou mensagem do Postgres nunca voltam.
    record(
      `error_leak:${value.slice(0, 16)}`,
      !/(at Object\.|node_modules|pg_|PostgresError|relation ".*" does not exist|stack)/i.test(
        body,
      ),
      "resposta vaza detalhe interno",
    );
  }

  // =======================================================================
  // 4. Payload grande e malformado
  // =======================================================================

  const oversized = JSON.stringify({ content: "a".repeat(2_000_000) });
  const oversizedResponse = await probe("/api/journal/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: oversized,
  });
  record(
    "oversized_payload",
    oversizedResponse.status >= 400,
    `status=${oversizedResponse.status}`,
  );

  const brokenJson = await probe("/api/journal/entries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{ nao e json",
  });
  record("malformed_json", brokenJson.status >= 400, `status=${brokenJson.status}`);

  // =======================================================================
  // 5. Cabecalhos de seguranca e misconfiguration
  // =======================================================================

  const page = await probe("/entrar");
  const headers = page.headers;

  record(
    "header_csp",
    (headers.get("content-security-policy") ?? "").includes("default-src 'self'"),
    "CSP ausente ou permissiva",
  );
  record(
    "csp_no_unsafe_inline_script",
    !/script-src[^;]*'unsafe-inline'/.test(
      headers.get("content-security-policy") ?? "",
    ),
    "script-src permite unsafe-inline",
  );
  // PRO-7R: o host de midia entra so em connect-src; nenhum curinga.
  record(
    "csp_no_wildcard_media",
    !/(connect-src|media-src|frame-src|img-src|worker-src)[^;]*\s\*(\s|;|$)/.test(
      headers.get("content-security-policy") ?? "",
    ),
    "CSP com curinga em connect/media/frame/img/worker",
  );
  record(
    "csp_frame_ancestors",
    (headers.get("content-security-policy") ?? "").includes(
      "frame-ancestors 'none'",
    ),
    "clickjacking nao bloqueado",
  );
  record(
    "header_frame_options",
    headers.get("x-frame-options") === "DENY",
    "X-Frame-Options ausente",
  );
  record(
    "header_nosniff",
    headers.get("x-content-type-options") === "nosniff",
    "nosniff ausente",
  );
  record(
    "header_referrer",
    (headers.get("referrer-policy") ?? "").includes("strict-origin"),
    "Referrer-Policy fraca",
  );
  record(
    "permissions_policy_multimodal",
    (headers.get("permissions-policy") ?? "").includes("camera=(self)"),
    "camera bloqueada — quebraria o multimodal",
  );

  // lado de geolocation; geolocation virou produto no SUP-2).
  record(
    "permissions_policy_denies_rest",
    ["payment=()", "usb=()", "serial=()", "hid=()", "midi=()"].every((item) =>
      (headers.get("permissions-policy") ?? "").includes(item),
    ),
    "recursos nao usados nao foram negados",
  );
  // SUP-2 (ADR-0032): localizacao so para a propria origem, nunca curinga.
  record(
    "permissions_policy_geolocation_self_only",
    /(^|, )geolocation=\(self\)(,|$)/.test(headers.get("permissions-policy") ?? ""),
    "geolocation diferente de (self)",
  );
  record(
    "no_hsts_over_http",
    headers.get("strict-transport-security") === null,
    "HSTS emitido sobre http",
  );
  record(
    "no_server_banner",
    !(headers.get("x-powered-by") ?? "").toLowerCase().includes("next"),
    "banner de tecnologia exposto",
  );


  const nonceResponse = await probe("/entrar");
  const nonceCsp = nonceResponse.headers.get("content-security-policy") ?? "";
  const nonceHtml = await nonceResponse.text();

  const inlineScripts = (
    nonceHtml.match(/<script(?![^>]*\ssrc=)[^>]*>/g) ?? []
  ).length;
  const noncedScripts = (nonceHtml.match(/<script[^>]*\snonce="/g) ?? []).length;
  record(
    "csp_nonce_reaches_inline_scripts",
    inlineScripts === 0 || noncedScripts >= inlineScripts,
    `inline=${inlineScripts} com_nonce=${noncedScripts}`,
  );

  const htmlNonce = (nonceHtml.match(/nonce="([a-f0-9]+)"/) ?? [])[1];
  record(
    "csp_nonce_matches_header",
    htmlNonce !== undefined && nonceCsp.includes(`'nonce-${htmlNonce}'`),
    `html=${htmlNonce ?? "ausente"}`,
  );

  // Nonce reutilizado entre requests anularia o proposito: um atacante que
  // aprendesse um valor poderia injetar script em qualquer pagina seguinte.
  const secondResponse = await probe("/entrar");
  const secondNonce = ((await secondResponse.text()).match(
    /nonce="([a-f0-9]+)"/,
  ) ?? [])[1];
  record(
    "csp_nonce_is_per_request",
    secondNonce !== undefined && secondNonce !== htmlNonce,
    "nonce repetido entre requests",
  );

  const apiHeaders = (await probe("/api/me/profile")).headers;
  record(
    "api_no_store",
    (apiHeaders.get("cache-control") ?? "").includes("no-store"),
    "resposta de API pode ir para cache compartilhado",
  );

  // =======================================================================
  // 6. Metodos e rotas que nao devem existir
  // =======================================================================

  for (const path of [
    "/api/admin",
    "/api/debug",
    "/.env",
    "/.env.local",
    "/api/me/export/../../etc/passwd",
  ]) {
    const response = await probe(path);
    record(`hidden:${path}`, response.status >= 400, `status=${response.status}`);
  }

  // `fetch` do Node recusa TRACE no proprio cliente. Isso ja e o resultado
  // desejado — o metodo nao trafega — entao a excecao conta como recusa, e nao
  // como falha da sonda.
  let traceStatus = "client_rejected";
  try {
    traceStatus = String(
      (await probe("/api/me/profile", { method: "TRACE" })).status,
    );
  } catch {
    traceStatus = "client_rejected";
  }
  record(
    "method_trace",
    traceStatus === "client_rejected" || Number(traceStatus) >= 400,
    `status=${traceStatus}`,
  );

  // =======================================================================
  // 7. Rate limiting observavel
  // =======================================================================

  let limited = false;
  // =======================================================================

  // =======================================================================

  /*
    Rota interna do dispatcher: sem o segredo certo ela nao existe (404), nao
    importa o metodo nem o formato da credencial, e a resposta nunca carrega
    contagem, titular ou pista de configuracao.
  */
  for (const [label, headers] of [
    ["none", {}],
    ["wrong_bearer", { authorization: "Bearer 0000000000000000000000000000000000000000" }],
    ["basic", { authorization: "Basic ZWx5cmE6ZWx5cmE=" }],
    ["empty_bearer", { authorization: "Bearer " }],
  ]) {
    const response = await probe("/api/internal/notifications/dispatch", { method: "POST", headers });
    const body = await response.text();
    record(`internal_dispatch:${label}`, response.status === 404 || response.status === 429, `status=${response.status}`);
    record(`internal_dispatch_leak:${label}`, !/delivered|selected|transport|runId|brevo|mailpit/i.test(body), "corpo com dado do dispatcher");
  }
  const dispatchGet = await probe("/api/internal/notifications/dispatch");
  record("internal_dispatch:get", dispatchGet.status >= 400, `status=${dispatchGet.status}`);

  /*
    Confirmacao do recovery: token malformado nao mostra o botao (nada vai ao
    GoTrue) e nenhum valor da URL volta refletido sem escape.
  */
  const xss = encodeURIComponent('"><script>alert(1)</script>');
  const confirmXss = await probe(`/redefinir-senha/confirmar?token_hash=${xss}`);
  const confirmXssBody = await confirmXss.text();
  record("recovery_confirm_xss", !confirmXssBody.includes("<script>alert(1)</script>"), "valor refletido sem escape");
  record("recovery_confirm_malformed", !confirmXssBody.includes('name="token_hash"'), "token malformado virou formulario");
  const confirmRedirect = await probe(`/redefinir-senha/confirmar?token_hash=${"a".repeat(56)}&next=https://evil.example`);
  record(
    "recovery_confirm_open_redirect",
    !(confirmRedirect.headers.get("location") ?? "").includes("evil.example"),
    `location=${confirmRedirect.headers.get("location")}`,
  );
  /*
    L-398: `returnTo` de Privacidade e Convite. Sem sessao a rota manda para o
    login; o destino nunca pode sair da origem, com o valor cru ou codificado.
  */
  for (const route of ["/configuracoes/privacidade", "/convite"]) {
    for (const value of ["https://evil.example", "//evil.example", "%2F%2Fevil.example", "javascript:alert(1)"]) {
      const response = await probe(`${route}?returnTo=${encodeURIComponent(value)}`);
      const location = response.headers.get("location") ?? "";
      const target = location ? new URL(location, baseUrl) : null;
      record(
        `return_to_open_redirect ${route} ${value}`,
        !target || (target.origin === new URL(baseUrl).origin && !/^javascript:/i.test(location)),
        `location=${location}`,
      );
    }
  }
  record(
    "recovery_confirm_referrer",
    /no-referrer/.test(await confirmRedirect.text()),
    "pagina com token sem politica no-referrer",
  );

  for (let attempt = 0; attempt < 40; attempt += 1) {
    const response = await probe("/api/multimodal/assets", { method: "POST" });
    if (response.status === 429) {
      limited = true;
      record(
        "rate_limit_retry_after",
        response.headers.get("retry-after") !== null,
        "429 sem Retry-After",
      );
      break;
    }
    // Sem sessao a rota recusa antes do limitador; isso tambem e aceitavel.
    if (response.status === 401) {
      limited = true;
      break;
    }
  }
  record("rate_limit_or_auth_first", limited, "endpoint aceitou 40 tentativas");
} catch (error) {
  failure = error;
}

if (failure) {
  console.error(
    `SECURITY_PROBE=FAIL reason=${failure instanceof Error ? failure.message : "unknown"}`,
  );
  process.exit(1);
}

if (findings.length > 0) {
  console.error(`SECURITY_PROBE=FINDINGS checks=${checks} open=${findings.length}`);
  for (const finding of findings) {
    console.error(`  - ${finding.id}: ${finding.detail}`);
  }
  process.exit(1);
}

console.log(
  `SECURITY_PROBE=PASS checks=${checks} findings=0 target=${baseUrl} scope=auth_bypass,idor,injection,xss,error_leak,oversized,headers,hidden_routes,rate_limit`,
);
