import { SUPPORT_MAP_PROVIDER } from "@/lib/support-network/map-provider";



/** Diretivas independentes do ambiente e do nonce. */
export const STATIC_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  // Clickjacking. `frame-ancestors` na CSP e a versao moderna; o header antigo
  // permanece para navegadores que so entendem ele.
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  // Nunca vazar o caminho completo — que pode conter id de sessao ou de
  // paciente — para um destino de outra origem.
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Cross-Origin-Opener-Policy": "same-origin",
  "X-DNS-Prefetch-Control": "off",

  "Permissions-Policy": [
    "camera=(self)",
    "microphone=(self)",
    "display-capture=(self)",
    "accelerometer=()",
    "ambient-light-sensor=()",
    "autoplay=()",
    "battery=()",
    "browsing-topics=()",
    /*
      SUP-2 (ADR-0032): localizacao opt-in da Rede de Apoio. So a propria
      origem — nenhum iframe/terceiro herda — e o navegador ainda pede
      permissao, que a pagina so dispara depois do toque em "Usar minha
      localizacao". Nunca no carregamento, no SOS ou no mapa.
    */
    "geolocation=(self)",
    "gyroscope=()",
    "hid=()",
    "idle-detection=()",
    "local-fonts=()",
    "magnetometer=()",
    "midi=()",
    "payment=()",
    "serial=()",
    "usb=()",
    "xr-spatial-tracking=()",
  ].join(", "),
};

export interface CspOptions {
  nonce: string;
  supabaseUrl?: string;
  /**
   * PRO-7R: servidor de midia (LiveKit, ADR-0025). So a origem configurada
   * entra em `connect-src`, em ws/wss (sinalizacao) e http/https (validacao
   * de conexao do SDK). Nunca `*`: sem host valido, a diretiva nao muda.
   */
  realtimeUrl?: string;
  /** Em desenvolvimento o Next precisa de `eval` para HMR. */
  development?: boolean;
}

/**
 * Origem do Supabase, sem caminho.
 *
 * `connect-src` e `img-src` precisam do host, nao da URL inteira. Uma URL
 * invalida vira `null` e a diretiva simplesmente nao ganha o host — em vez de
 * ganhar uma string quebrada que o navegador ignoraria por inteiro.
 */
function supabaseOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    return new URL(raw.trim()).origin;
  } catch {
    return null;
  }
}

/** Origem ws/wss do servidor de midia; qualquer outro esquema e ignorado. */
function realtimeOrigin(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    return url.protocol === "ws:" || url.protocol === "wss:" ? `${url.protocol}//${url.host}` : null;
  } catch {
    return null;
  }
}

/**
 * Monta a `Content-Security-Policy`.
 *
 * `script-src` usa **nonce** em vez de `'unsafe-inline'`. O Next.js propaga o
 * nonce para os proprios scripts de bootstrap quando o encontra no header da
 * request, entao a pagina hidrata sem abrir a porta para script injetado.
 *
 * `style-src` mantem `'unsafe-inline'`: o Tailwind e o proprio Next injetam
 * estilo inline, e nao ha nonce propagado para eles. E risco residual
 * documentado no Threat Model, nao um descuido.
 */
export function buildContentSecurityPolicy(options: CspOptions): string {
  const supabase = supabaseOrigin(options.supabaseUrl);

  const connect = ["'self'"];
  if (supabase) {
    connect.push(supabase);
    // Realtime/websocket do Supabase usa o mesmo host em ws/wss.
    connect.push(supabase.replace(/^http/, "ws"));
  }
  /*
    SUP-2 (ADR-0032): estilo, tiles, glifos e sprites do mapa da Rede de Apoio.
    O MapLibre busca tudo por `fetch` (inclusive imagens do sprite), entao so
    `connect-src` ganha o host - `img-src` e `worker-src` nao mudam (o worker
    vem de `'self'`, /vendor/maplibre). O host sai do provider central.
  */
  connect.push(...SUPPORT_MAP_PROVIDER.connectOrigins);
  const realtime = realtimeOrigin(options.realtimeUrl);
  if (realtime) {
    connect.push(realtime, realtime.replace(/^ws/, "http"));
  }

  const scriptSrc = [
    `'self'`,
    `'nonce-${options.nonce}'`,

    "'wasm-unsafe-eval'",
  ];
  if (options.development) {
    // HMR do Next em desenvolvimento. Nunca em producao.
    scriptSrc.push("'unsafe-eval'");
  }

  const directives: [string, string[]][] = [
    ["default-src", ["'self'"]],
    ["script-src", scriptSrc],
    ["style-src", ["'self'", "'unsafe-inline'"]],
    // `blob:` e obrigatorio: a previa da captura multimodal e um Blob local.
    ["img-src", ["'self'", "blob:", "data:", ...(supabase ? [supabase] : [])]],
    ["media-src", ["'self'", "blob:", ...(supabase ? [supabase] : [])]],
    ["font-src", ["'self'", "data:"]],
    ["connect-src", connect],
    // A Elyra nao embute nem e embutida.
    ["frame-src", ["'none'"]],
    ["frame-ancestors", ["'none'"]],
    ["object-src", ["'none'"]],
    ["base-uri", ["'self'"]],
    // Server Actions postam para a propria origem e nada mais.
    ["form-action", ["'self'"]],
    ["worker-src", ["'self'", "blob:"]],
    ["manifest-src", ["'self'"]],
  ];

  const policy = directives
    .map(([name, values]) => `${name} ${values.join(" ")}`)
    .join("; ");

  /**
   * `upgrade-insecure-requests` so entra quando **nao existe origem http na
   * propria politica**.
   *
   * A tentacao e condicionar ao `NODE_ENV`, mas isso esta errado: `next start`
   * roda em modo producao tambem no QA local, onde o Supabase e
   * `http://127.0.0.1:54381`. A diretiva promoveria essa chamada para https e
   * derrubaria toda a persistencia — hardening quebrando o produto.
   *
   * A condicao real e mixed content: se o proprio backend e http, nao ha o que
   * promover.
   */
  const hasInsecureOrigin = policy.includes("http://") || policy.includes("ws://");
  return hasInsecureOrigin ? policy : `${policy}; upgrade-insecure-requests`;
}

/**
 * `Strict-Transport-Security` **somente** quando a request ja chegou por HTTPS.
 *
 * Emitir HSTS em http local instruiria o navegador a exigir TLS de `localhost`
 * pelos proximos meses, quebrando o ambiente de desenvolvimento de quem abrisse
 * a aplicacao uma vez.
 */
export function strictTransportSecurity(protocol: string): string | null {
  if (protocol !== "https:") return null;
  return "max-age=63072000; includeSubDomains; preload";
}

/**
 * Respostas com dado pessoal nao ficam em cache compartilhado nem em disco.
 *
 * Aplica-se a `/api` e a export/exclusao do titular: um proxy intermediario
 * guardando a resposta de `/api/me/profile` serviria o perfil de uma pessoa
 * para outra.
 */
export const NO_STORE_HEADERS: Readonly<Record<string, string>> = {
  "Cache-Control": "no-store, no-cache, must-revalidate, private",
  Pragma: "no-cache",
};
