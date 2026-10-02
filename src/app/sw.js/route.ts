

export const dynamic = "force-static";

const BUILD_ID = process.env.NEXT_PUBLIC_ELYRA_BUILD ?? "dev";

const WORKER_SOURCE = `/* Elyra service worker â€” build ${BUILD_ID} */
const BUILD = ${JSON.stringify(BUILD_ID)};
const SHELL_CACHE = "elyra-shell-" + BUILD;
const STATIC_CACHE = "elyra-static-" + BUILD;
const SHELL_URL = "/offline";
const PUBLIC_ASSETS = ["/manifest.webmanifest", "/placeholder/icon-192.png", "/placeholder/icon-512.png"];


function isFullResponse(response) {
  return response.status === 200 && response.type === "basic";
}

function unescapeHtml(value) {
  return value.replace(/&amp;/g, "&");
}

async function precache() {
  const response = await fetch(SHELL_URL, { cache: "no-store", credentials: "same-origin" });
  if (!response.ok) throw new Error("shell_unavailable");
  const html = await response.clone().text();
  const shell = await caches.open(SHELL_CACHE);
  await shell.put(SHELL_URL, response);

  const assets = new Set();
  for (const match of html.matchAll(/\\/_next\\/static\\/[A-Za-z0-9_\\-.\\/]+/g)) assets.add(match[0]);
  for (const match of html.matchAll(/\\/_next\\/image\\?url=%2Fbrand%2F[^"\\s,\\\\]+/g)) {
    assets.add(unescapeHtml(match[0]));
  }

  const staticCache = await caches.open(STATIC_CACHE);
  for (const css of [...assets].filter((url) => url.endsWith(".css"))) {
    const cssResponse = await fetch(css);
    if (!isFullResponse(cssResponse)) continue;
    const text = await cssResponse.clone().text();
    await staticCache.put(css, cssResponse);
    for (const font of text.matchAll(/url\\((\\/_next\\/static\\/media\\/[^)]+)\\)/g)) assets.add(font[1]);
  }

  const pending = [...assets].filter((url) => !url.endsWith(".css"));
  for (const url of PUBLIC_ASSETS) pending.push(url);
  await Promise.all(
    pending.map(async (url) => {
      const assetResponse = await fetch(url);
      if (isFullResponse(assetResponse)) await staticCache.put(url, assetResponse);
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precache().then(() => {
      // Primeira instalacao ativa direto; atualizacao espera o gesto da pessoa.
      if (!self.registration.active) return self.skipWaiting();
      return undefined;
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("elyra-") && key !== SHELL_CACHE && key !== STATIC_CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  if (url.pathname.startsWith("/_next/static/")) return true;
  if (
    url.pathname.startsWith("/placeholder/") ||
    url.pathname.startsWith("/brand/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/product/")
  ) return true;
  if (url.pathname === "/manifest.webmanifest") return true;
  if (url.pathname === "/_next/image") {
    const source = url.searchParams.get("url") || "";
    return source.startsWith("/placeholder/") || source.startsWith("/brand/") || source.startsWith("/product/");
  }
  return false;
}

async function cacheFirst(request) {
  // Defesa em profundidade: o handler de fetch ja deixa Range passar direto.
  if (request.headers.has("range")) return fetch(request);
  const cached = await caches.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (isFullResponse(response)) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function shellResponse() {
  const cached = await caches.match(SHELL_URL, { ignoreSearch: true });
  return (
    cached ||
    new Response("Sem conexÃ£o.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    })
  );
}

async function navigate(request, url) {
  /*
    O shell vem do cache primeiro. Ele nao tem dado de ninguem, e com Wi-Fi sem
    saida a rede nao recusa: ela demora. Esperar o servidor aqui deixaria a
    pessoa olhando tela em branco justo quando o app deveria abrir local.
  */
  if (url.pathname === SHELL_URL) {
    const shell = await shellResponse();
    if (shell.ok) return shell;
  }
  try {
    // NETWORK_FIRST sem guardar: HTML autenticado tem dado pessoal.
    return await fetch(request);
  } catch (error) {
    if (url.pathname === SHELL_URL) return shellResponse();
    const destination = SHELL_URL + "?de=" + encodeURIComponent(url.pathname);
    return Response.redirect(destination, 302);
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  /*
    Range (video/audio pedindo pedaco do arquivo): NETWORK_ONLY, sem
    respondWith. O navegador busca direto no servidor e recebe o 206 com
    Content-Range; nada disso passa pelo Cache Storage, que nao guarda parcial.
  */
  if (request.headers.has("range")) return;

  if (request.mode === "navigate") {
    event.respondWith(navigate(request, url));
    return;
  }
  if (isImmutableAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // Todo o resto (APIs, RSC, Server Actions, modelos /asr e /vision): NETWORK_ONLY.
});
`;

export function GET() {
  return new Response(WORKER_SOURCE, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // O navegador precisa revalidar o worker a cada abertura para achar versao nova.
      "cache-control": "no-cache, no-store, must-revalidate",
    },
  });
}
