

export const ASR_AB_FLAG = "NEXT_PUBLIC_ASR_AB_COMPARISON";
export const QA_RUNTIME_ENV = "qa" as const;

export type ModeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * Checagem completa. So o servidor consegue faze-la, porque so ele enxerga
 * `ELYRA_RUNTIME_ENV`.
 */
export function asrAbComparisonAllowed(
  environment: ModeEnvironment = process.env,
): boolean {
  return (
    environment.ELYRA_RUNTIME_ENV === QA_RUNTIME_ENV &&
    environment[ASR_AB_FLAG] === "1"
  );
}

/**
 * Checagem do cliente — a metade que o navegador consegue ver.
 *
 * Ela e **mais fraca** de proposito, e nao substitui a de cima: a autoridade e
 * a rota. Existe para que um componente montado por engano fora do fluxo de QA
 * ainda se recuse a rodar.
 */
export function asrAbComparisonFlagEnabled(
  environment?: ModeEnvironment,
): boolean {
  if (environment) return environment[ASR_AB_FLAG] === "1";

  /*
    Acesso **literal**, e nao `process.env[ASR_AB_FLAG]`.

    O Next substitui `process.env.NEXT_PUBLIC_X` por uma constante em tempo de
    build, e so quando a chave e um literal no codigo. Com indice dinamico nao
    ha o que substituir: no navegador `process.env` chega vazio, a funcao
    devolve `false`, e a tela some **sem erro nenhum** — o pior tipo de falha,
    porque parece funcionamento.
  */
  return process.env.NEXT_PUBLIC_ASR_AB_COMPARISON === "1";
}
