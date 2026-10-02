/**
 * O caminho da requisicao atual, publicado pelo proxy para o App Router.
 *
 * ## Por que existe
 *
 * Um layout de servidor nao conhece o pathname. O portao de consentimento
 * precisa dele para devolver a pessoa ao destino original depois do aceite —
 * quem tentou `/sessoes` volta para `/sessoes`, e nao para o dashboard.
 *
 * `Referer` nao serve: e opcional, o navegador omite em varias situacoes, e e
 * escolhido por quem chama.
 *
 * ## Por que num modulo proprio
 *
 * A constante nasceu dentro de `supabase/proxy.ts`, junto de `updateSession`.
 * Importa-la de la arrastava `next/server`, `@supabase/ssr` e todo o grafo do
 * middleware para dentro do render de **cada pagina autenticada**, so para ler
 * uma string — e invertia a direcao da dependencia: codigo de pagina passando a
 * depender de codigo de middleware.
 *
 * ## O contrato de seguranca
 *
 * O proxy **sobrescreve** este header a cada requisicao. Ele copia os headers do
 * cliente para dentro, entao um valor forjado chegaria junto; o `set` do proxy o
 * substitui pelo caminho real. Quem consome ainda passa o valor por
 * `safeInternalPath` antes de redirecionar — duas barreiras, porque esta e a
 * unica fonte de destino que o portao tem.
 */
export const REQUEST_PATH_HEADER = "x-elyra-path";
