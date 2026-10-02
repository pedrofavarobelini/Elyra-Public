import type { BrowserContext } from "@playwright/test";

/**
 * Corte de rede de verdade para E2E offline (OFF-1, L-406).
 *
 * `context.setOffline(true)` nao cobre o `fetch` do service worker de forma
 * confiavel: quando o Chromium reinicia o worker (ex.: a checagem de update do
 * `/sw.js` falha), o worker novo nasce fora da emulacao e alcanca o servidor.
 * Foi isso que fez `/perfil` "abrir online" sem rede: resposta `200` do worker,
 * vinda do servidor com `no-store` — nunca do Cache Storage (provado com sonda).
 *
 * `context.route` intercepta tambem as requisicoes do worker, entao as duas
 * camadas juntas reproduzem um aparelho sem rede.
 */
const ALL = "**/*";
const abort = (route: { abort: (code: string) => Promise<void> }) => route.abort("internetdisconnected");

export async function cutNetwork(context: BrowserContext) {
  await context.setOffline(true);
  await context.route(ALL, abort);
}

export async function restoreNetwork(context: BrowserContext) {
  await context.unroute(ALL, abort);
  await context.setOffline(false);
}

/** Worker ativo controlando a pagina e snapshot local gravado (pronto para ficar offline). */
export async function waitOfflineReady(target: import("@playwright/test").Page) {
  const { expect } = await import("@playwright/test");
  await target.waitForFunction(
    async () => Boolean((await navigator.serviceWorker.getRegistration())?.active && navigator.serviceWorker.controller),
    null,
    { timeout: 60_000 },
  );
  await expect
    .poll(
      () =>
        target.evaluate(
          () =>
            new Promise<number>((resolve) => {
              const request = indexedDB.open("elyra-offline");
              request.onsuccess = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains("snapshots")) return resolve(0);
                const count = db.transaction("snapshots").objectStore("snapshots").count();
                count.onsuccess = () => resolve(count.result);
                count.onerror = () => resolve(0);
              };
              request.onerror = () => resolve(0);
            }),
        ),
      { timeout: 30_000 },
    )
    .toBeGreaterThan(0);
}

/** Operacoes na outbox deste aparelho. */
export async function outboxSize(target: import("@playwright/test").Page) {
  return target.evaluate(
    () =>
      new Promise<number>((resolve) => {
        const request = indexedDB.open("elyra-offline");
        request.onsuccess = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains("outbox")) return resolve(0);
          const count = db.transaction("outbox").objectStore("outbox").count();
          count.onsuccess = () => resolve(count.result);
          count.onerror = () => resolve(-1);
        };
        request.onerror = () => resolve(-1);
      }),
  );
}
