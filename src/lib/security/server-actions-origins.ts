/**
 * Origens permitidas para Server Actions (`L-026`).
 *
 * A homologacao fisica precisa que um aparelho alcance o build por um host
 * HTTPS externo. O Next recusa Server Action cujo host encaminhado diverge da
 * origin, e toda escrita da Elyra e Server Action — sem a lista, o roteiro
 * falharia por transporte, nao por produto.
 *
 * A regra e **fail-closed em duas condicoes simultaneas**: so existe lista
 * quando o ambiente e declaradamente `qa` E a variavel de origens esta
 * preenchida. Producao, staging e desenvolvimento recebem `[]`, e o Next mantem
 * o comportamento padrao de mesma origem.
 *
 * Vive em modulo proprio, e nao inline no `next.config.ts`, porque uma regra de
 * seguranca que ninguem consegue testar e uma regra em que ninguem pode confiar.
 */

/** Ambiente onde — e somente onde — origens extras sao aceitas. */
export const QA_RUNTIME_ENV = "qa" as const;

export type OriginEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Um host de QA precisa ser um hostname concreto.
 *
 * Curinga, esquema, caminho e porta solta sao recusados: `*.trycloudflare.com`
 * aceitaria qualquer tunel que alguem levantasse, o que anula o proposito da
 * lista.
 */
function isAcceptableHost(candidate: string): boolean {
  if (!candidate || candidate.length > 253) return false;
  if (candidate.includes("*")) return false;
  if (candidate.includes("/")) return false;
  if (candidate.includes("://")) return false;
  // `host:porta` e valido; qualquer outra coisa com dois-pontos nao e.
  const [host, port, ...rest] = candidate.split(":");
  if (rest.length > 0) return false;
  if (port !== undefined && !/^\d{1,5}$/.test(port)) return false;
  return /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(
    host ?? "",
  );
}

export function qaAllowedOrigins(
  environment: OriginEnvironment = process.env,
): string[] {
  if (environment.ELYRA_RUNTIME_ENV !== QA_RUNTIME_ENV) return [];

  return (environment.ELYRA_QA_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(isAcceptableHost);
}

/**
 * Fragmento de configuracao do Next.
 *
 * Devolve `{}` — e nao `serverActions: { allowedOrigins: [] }` — quando nao ha
 * origem: uma lista vazia explicita e uma configuracao presente, e o objetivo e
 * que fora do QA a chave simplesmente nao exista.
 */
export function serverActionsConfig(
  environment: OriginEnvironment = process.env,
): Record<string, unknown> {
  const origins = qaAllowedOrigins(environment);
  if (origins.length === 0) return {};
  return { experimental: { serverActions: { allowedOrigins: origins } } };
}
