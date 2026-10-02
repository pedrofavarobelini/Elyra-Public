import { expect, type Page } from "@playwright/test";

import { formatTransportNavigationRecovery } from "../transport-navigation-recovery";

/**
 * Barreira de hidratacao para os testes E2E.
 *
 * `page.goto` resolve no evento `load`. Nesse ponto o HTML servido pelo Next ja
 * esta na tela e todos os botoes ja aceitam clique - mas os handlers React
 * ainda nao existem. Um clique nessa janela nao gera erro nem retry: ele some.
 * O teste so percebe no `expect` seguinte, que expira sem explicacao util. Foi
 * o modo de falha dominante de `L-046`.
 *
 * `HydrationMarker` publica `data-hydrated` no `<html>` quando o React assume a
 * pagina. Esperar por esse atributo e uma espera por **evento**, nao por tempo:
 * a maquina pode estar ociosa ou saturada e o teste continua correto - so muda
 * quanto ele espera. Por isso a correcao nao foi aumentar timeout.
 */
export async function waitForHydration(page: Page) {
  await expect(page.locator("html[data-hydrated='true']")).toBeAttached({
    timeout: 30_000,
  });
}

/**
 * `net::ERR_ABORTED` e falha de transporte, nao de produto.
 *
 * Ele aparece quando a navegacao e cancelada antes de entregar resposta - o
 * `capture.spec.ts` ja registrava esse sintoma sob concorrencia, e ele derrubou
 * `Dashboard > o atalho de check-in` numa regressao integral. Nesse estado
 * **nenhuma assercao chegou a rodar**: nao ha resultado de teste para preservar,
 * so uma requisicao que nunca aconteceu.
 *
 * Repetir a navegacao uma vez nesse caso especifico nao e "rodar de novo ate dar
 * verde". A distincao que importa: um `expect` que falha e informacao sobre o
 * produto e nunca e repetido aqui; uma navegacao abortada nao e informacao
 * nenhuma. O limite e uma tentativa extra, e so para esta mensagem de erro -
 * qualquer outra falha de `goto` sobe como sempre.
 */
const ABORTED = /net::ERR_ABORTED/;

/**
 * `page.goto` que so devolve o controle com a pagina interativa.
 *
 * `waitUntil: "commit"` em vez do `load` padrao: `data-hydrated` e um sinal
 * estritamente mais forte que `load` - se o React assumiu a pagina, ela
 * carregou - entao esperar pelos dois seria esperar duas vezes pela mesma
 * garantia, com a janela extra de cancelamento que produz o `ERR_ABORTED`.
 */
export async function gotoHydrated(
  page: Page,
  path: string,
  options?: Parameters<Page["goto"]>[1],
) {
  const navigate = () => page.goto(path, { waitUntil: "commit", ...options });

  let response;
  try {
    response = await navigate();
  } catch (error) {
    if (!(error instanceof Error) || !ABORTED.test(error.message)) throw error;
    const viewport = page.viewportSize();
    console.warn(
      formatTransportNavigationRecovery({
        route: path,
        viewport: viewport ? `${viewport.width}x${viewport.height}` : "unknown",
      }),
    );
    response = await navigate();
  }

  await waitForHydration(page);
  return response;
}
