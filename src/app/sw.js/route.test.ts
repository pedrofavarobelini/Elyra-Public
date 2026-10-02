// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { GET } from "./route";



const ORIGIN = "http://localhost:3000";

type Listener = (event: unknown) => void;

function response(status: number, body = "x", headers: Record<string, string> = {}) {
  const res = new Response(status === 204 ? null : body, { status, headers });
  Object.defineProperty(res, "type", { value: "basic" });
  const clone = res.clone.bind(res);
  Object.defineProperty(res, "clone", {
    value: () => {
      const copy = clone();
      Object.defineProperty(copy, "type", { value: "basic" });
      return copy;
    },
  });
  return res;
}

function request(path: string, init: { mode?: string; range?: string; method?: string } = {}) {
  const headers = new Headers();
  if (init.range) headers.set("range", init.range);
  return { url: ORIGIN + path, method: init.method ?? "GET", mode: init.mode ?? "no-cors", headers };
}

async function loadWorker() {
  const source = await GET().text();
  const listeners: Record<string, Listener> = {};
  const stored = new Map<string, Map<string, Response>>();
  const puts: { cache: string; url: string; status: number }[] = [];

  const openCache = async (name: string) => {
    if (!stored.has(name)) stored.set(name, new Map());
    const entries = stored.get(name)!;
    return {
      put: vi.fn(async (key: string | { url: string }, value: Response) => {
        if (value.status === 206) {
          throw new TypeError("Failed to execute 'put' on 'Cache': Partial response (status code 206) is unsupported");
        }
        const url = typeof key === "string" ? key : key.url;
        puts.push({ cache: name, url, status: value.status });
        entries.set(new URL(url, ORIGIN).pathname + new URL(url, ORIGIN).search, value);
      }),
    };
  };
  const caches = {
    open: vi.fn(openCache),
    match: vi.fn(async (key: string | { url: string }) => {
      const url = new URL(typeof key === "string" ? key : key.url, ORIGIN);
      for (const entries of stored.values()) {
        const hit = entries.get(url.pathname + url.search) ?? entries.get(url.pathname);
        if (hit) return hit.clone();
      }
      return undefined;
    }),
    keys: vi.fn(async () => [...stored.keys()]),
    delete: vi.fn(async (name: string) => stored.delete(name)),
  };
  const fetchMock = vi.fn<(input: unknown, init?: unknown) => Promise<Response>>();
  // `Response.redirect` do navegador resolve caminho relativo contra o worker.
  class WorkerResponse extends Response {
    static override redirect(url: string | URL, status?: number) {
      return Response.redirect(new URL(url, ORIGIN), status);
    }
  }
  const self = {
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    location: { origin: ORIGIN },
    registration: { active: null },
    skipWaiting: vi.fn(async () => undefined),
    clients: { claim: vi.fn(async () => undefined) },
  };
  new Function("self", "caches", "fetch", "Response", source)(self, caches, fetchMock, WorkerResponse);

  function dispatchFetch(req: ReturnType<typeof request>) {
    let responded: Promise<Response> | null = null;
    listeners.fetch!({ request: req, respondWith: (value: Promise<Response>) => (responded = value) });
    return responded as Promise<Response> | null;
  }

  return { source, listeners, caches, fetchMock, puts, stored, dispatchFetch };
}

const DESKTOP_MP4 = "/brand/motion/elyra-desktop-intro-v1.mp4";
const MOBILE_MP4 = "/brand/motion/elyra-mobile-intro-v1.mp4";
const PRODUCT_AVIF = "/placeholder/artwork.svg";

describe("sw.js — Range Requests e Cache Storage", () => {
  it("L-420: asset editorial /product usa CACHE_FIRST sem ampliar o precache", async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValueOnce(response(200, "avif-completo"));

    const first = worker.dispatchFetch(request(PRODUCT_AVIF));
    expect(first).not.toBeNull();
    expect(await (await first!).text()).toBe("avif-completo");
    expect(worker.puts).toEqual([expect.objectContaining({ url: ORIGIN + PRODUCT_AVIF, status: 200 })]);

    const second = worker.dispatchFetch(request(PRODUCT_AVIF));
    expect(await (await second!).text()).toBe("avif-completo");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it("A/D: GET normal de asset de marca usa CACHE_FIRST e guarda a resposta 200", async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValueOnce(response(200, "mp4-completo"));

    const first = worker.dispatchFetch(request(DESKTOP_MP4));
    expect(first).not.toBeNull();
    expect((await first!).status).toBe(200);
    expect(worker.puts).toEqual([expect.objectContaining({ url: ORIGIN + DESKTOP_MP4, status: 200 })]);
    expect(worker.puts[0]!.cache).toMatch(/^elyra-static-/);

    // Segunda vez sai do cache, sem rede.
    const second = worker.dispatchFetch(request(DESKTOP_MP4));
    expect(await (await second!).text()).toBe("mp4-completo");
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([DESKTOP_MP4, MOBILE_MP4])("B: GET com Range (%s) nao passa pelo worker nem pelo cache", async (path) => {
    const worker = await loadWorker();

    const responded = worker.dispatchFetch(request(path, { range: "bytes=0-1023" }));

    // Sem respondWith: o navegador busca direto e recebe o 206 do servidor.
    expect(responded).toBeNull();
    expect(worker.fetchMock).not.toHaveBeenCalled();
    expect(worker.caches.match).not.toHaveBeenCalled();
    expect(worker.puts).toEqual([]);
  });

  it("B: Range nao e respondido com o arquivo completo guardado antes", async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValueOnce(response(200, "mp4-completo"));
    await worker.dispatchFetch(request(DESKTOP_MP4));

    expect(worker.dispatchFetch(request(DESKTOP_MP4, { range: "bytes=1024-2047" }))).toBeNull();
  });

  it("C: resposta 206 nunca vai para o Cache Storage e chega intacta ao player", async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValueOnce(
      response(206, "pedaco", { "content-range": "bytes 0-5/1314123" }),
    );

    // Sem header Range na requisicao, mas o servidor devolveu parcial mesmo assim.
    const responded = worker.dispatchFetch(request(MOBILE_MP4));
    const res = await responded!;

    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe("bytes 0-5/1314123");
    expect(worker.puts).toEqual([]);
  });

  it("C: outras respostas nao-200 (404, 204) tambem ficam fora do cache", async () => {
    const worker = await loadWorker();
    worker.fetchMock.mockResolvedValueOnce(response(404)).mockResolvedValueOnce(response(204));

    expect((await worker.dispatchFetch(request("/brand/nao-existe.png"))!).status).toBe(404);
    expect((await worker.dispatchFetch(request("/placeholder/icon-192.png"))!).status).toBe(204);
    expect(worker.puts).toEqual([]);
  });

  it("o worker publicado carrega a regra de Range (bytes mudam e o navegador acha versao nova)", async () => {
    const { source } = await loadWorker();
    expect(source).toContain('request.headers.has("range")');
    expect(source).toContain("response.status === 200");
    expect(source).not.toMatch(/response\.ok && response\.type/);
  });
});

describe("sw.js — estrategias existentes nao regridem (E)", () => {
  it("API e rotas dinamicas continuam NETWORK_ONLY, sem respondWith", async () => {
    const worker = await loadWorker();
    expect(worker.dispatchFetch(request("/api/journal/entries"))).toBeNull();
    expect(worker.dispatchFetch(request("/asr/model.bin"))).toBeNull();
    expect(worker.dispatchFetch(request(DESKTOP_MP4, { method: "POST" }))).toBeNull();
  });

  it("PRO-7R: token de midia, eventos e servidor LiveKit sao NETWORK_ONLY (nada em cache)", async () => {
    const worker = await loadWorker();
    const media = "/api/professional-sessions/00000000-0000-4000-8000-000000000000/media";
    expect(worker.dispatchFetch(request(media, { method: "POST" })), "POST token").toBeNull();
    expect(worker.dispatchFetch(request(media, { method: "PUT" })), "PUT evento").toBeNull();
    expect(worker.dispatchFetch(request(media)), "GET media").toBeNull();
    // Servidor de midia e outra origem: o worker nem olha (sinalizacao, validacao, midia).
    for (const url of ["http://localhost:7880/rtc/validate?access_token=x", "http://localhost:7880/rtc?access_token=x"]) {
      expect(worker.dispatchFetch({ url, method: "GET", mode: "cors", headers: new Headers() }), url).toBeNull();
    }
    expect(worker.puts.length).toBe(0);
  });

  it("PRO-6/PRO-7: agenda e sessao sao ONLINE_ONLY — API sem respondWith; pagina nunca vai para o cache", async () => {
    const worker = await loadWorker();
    for (const path of [
      "/api/scheduling/slots?professional=x",
      "/api/scheduling/appointments",
      "/api/scheduling/appointments/00000000-0000-4000-8000-000000000000",
      "/api/scheduling/availability",
      "/api/scheduling/availability/exceptions",
      "/api/scheduling/availability/exceptions/00000000-0000-4000-8000-000000000000",
      // PRO-7: sessao, consentimento e transcricao nunca passam pelo cache.
      "/api/professional-sessions",
      "/api/professional-sessions/00000000-0000-4000-8000-000000000000",
      "/api/professional-sessions/00000000-0000-4000-8000-000000000000/consents",
      "/api/professional-sessions/00000000-0000-4000-8000-000000000000/transcript",
    ]) {
      expect(worker.dispatchFetch(request(path)), path).toBeNull();
    }
    worker.fetchMock.mockResolvedValueOnce(response(200, "<html>agenda</html>"));
    await worker.dispatchFetch(request("/agenda", { mode: "navigate" }));
    // Mesmo com o Cache Storage aberto e escrevivel, nada de agenda, sessao ou API.
    const everything = [...worker.stored.values()].flatMap((entries) => [...entries.keys()]);
    expect(worker.puts.length, "nenhum put durante a navegacao da agenda").toBe(0);
    expect(everything.some((key) => /agenda|sess|\/api\//.test(key)), everything.join(",")).toBe(false);
    // Sem rede: shell offline, nunca uma agenda velha.
    worker.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const offline = await worker.dispatchFetch(request("/pro/agenda", { mode: "navigate" }))!;
    expect(offline.headers.get("location")).toBe(`${ORIGIN}/offline?de=%2Fpro%2Fagenda`);
  });

  it("navegacao sem rede cai no shell offline guardado", async () => {
    const worker = await loadWorker();
    const shellCache = await worker.caches.open("elyra-shell-dev");
    await shellCache.put("/offline", response(200, "<html>offline</html>"));
    worker.fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));

    const res = await worker.dispatchFetch(request("/diario", { mode: "navigate" }))!;

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${ORIGIN}/offline?de=%2Fdiario`);

    const shell = await worker.dispatchFetch(request("/offline", { mode: "navigate" }))!;
    expect(await shell.text()).toBe("<html>offline</html>");
  });

  it("precache guarda shell, CSS, fonte e assets publicos completos e pula o que nao for 200", async () => {
    const worker = await loadWorker();
    const html = '<link href="/_next/static/css/app.css"><script src="/_next/static/chunks/main.js"></script>';
    worker.fetchMock.mockImplementation(async (input: unknown) => {
      const url = String(input);
      if (url === "/offline") return response(200, html);
      if (url.endsWith("app.css")) return response(200, "a{src:url(/_next/static/media/font.woff2)}");
      if (url === "/placeholder/icon-512.png") return response(206, "parcial");
      return response(200, "ok");
    });
    let installing: Promise<unknown> = Promise.resolve();
    worker.listeners.install!({ waitUntil: (value: Promise<unknown>) => (installing = value) });
    await installing;

    const cachedUrls = worker.puts.map((entry) => entry.url).sort();
    expect(cachedUrls).toEqual(
      [
        "/_next/static/chunks/main.js",
        "/_next/static/css/app.css",
        "/_next/static/media/font.woff2",
        "/placeholder/icon-192.png",
        "/manifest.webmanifest",
        "/offline",
      ].sort(),
    );
    expect(worker.puts.every((entry) => entry.status === 200)).toBe(true);
  });

  it("ativacao apaga so caches Elyra de outro build", async () => {
    const worker = await loadWorker();
    await worker.caches.open("elyra-static-build-antigo");
    await worker.caches.open("elyra-shell-dev");
    await worker.caches.open("outro-app");
    let activating: Promise<unknown> = Promise.resolve();
    worker.listeners.activate!({ waitUntil: (value: Promise<unknown>) => (activating = value) });
    await activating;

    expect(worker.caches.delete).toHaveBeenCalledTimes(1);
    expect(worker.caches.delete).toHaveBeenCalledWith("elyra-static-build-antigo");
  });
});
