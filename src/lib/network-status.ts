

export const NETWORK_UNAVAILABLE_MESSAGE =
  "Sem conexão agora. O que você escreveu continua aqui." as const;

/**
 * Falha de transporte: o pedido nao alcancou o servidor.
 *
 * Subclasse de `Error` com a mesma `message` legivel que os chamadores ja
 * exibem — quem faz `caught instanceof Error ? caught.message : ...` continua
 * funcionando sem alteracao. O tipo acrescenta informacao para quem quiser
 * distinguir; ele nao muda o contrato de quem nao quiser.
 */
export class NetworkUnavailableError extends Error {
  readonly retryable = true;

  constructor(
    /** O que a pessoa tentava fazer, para a tela poder reoferecer a acao. */
    public readonly intent?: string,
    cause?: unknown,
  ) {
    super(NETWORK_UNAVAILABLE_MESSAGE, { cause });
    this.name = "NetworkUnavailableError";
  }
}

export function isNetworkUnavailable(error: unknown): boolean {
  return error instanceof NetworkUnavailableError;
}

/**
 * O navegador acha que esta online?
 *
 * `navigator.onLine` responde "ha interface de rede ativa", e nao "a internet
 * funciona": um Wi-Fi de hotel sem saida devolve `true`. Por isso ele governa
 * apenas o **aviso**, e nunca a decisao de gravar. A verdade sobre o pedido vem
 * do proprio pedido — e e o `fetch` que rejeita quem produz
 * `NetworkUnavailableError`.
 */
export function isBrowserOnline(): boolean {
  if (typeof navigator === "undefined") return true;
  return navigator.onLine;
}

/** Assinatura dos eventos de rede, para `useSyncExternalStore`. */
export function subscribeToNetworkStatus(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/**
 * No servidor, assume-se online.
 *
 * O HTML e renderizado por quem tem rede por definicao — o proprio servidor.
 * Come�ar "offline" faria toda pagina nascer com um aviso que a hidratacao
 * removeria em seguida, piscando um problema que nao existe.
 */
export function serverNetworkSnapshot(): boolean {
  return true;
}
