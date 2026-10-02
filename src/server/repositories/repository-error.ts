import "server-only";


/**
 * `PGRST116` — o PostgREST devolve isso quando `.single()` nao encontra linha.
 *
 * Importa distinguir porque, com `.single()`, "zero linhas" chega como **erro**, e
 * nao como `data` nulo: e a forma que a recusa de RLS assume nesse caminho
 * (`L-051`). Onde zero linhas e ausencia, o repositorio devolve `null` e o
 * servico escolhe o status; onde zero linhas seria anomalia, o log ganha causa
 * propria em vez de virar "falha de banco" generica.
 */
export const NO_ROWS_CODE = "PGRST116" as const;

export function semLinhas(causa: unknown): boolean {
  return normalizarCausa(causa)?.code === NO_ROWS_CODE;
}

/** Causa para "a consulta terminou sem erro e sem linha" — anomalia, nao ausencia. */
export const SEM_RESULTADO: CausaDeFalha = {
  code: "empty_result",
  message: "a operacao terminou sem erro e sem linha",
};

export interface CausaDeFalha {
  code?: string;
  message?: string;
  hint?: string;
}

/**
 * Aceita tanto o erro do PostgREST quanto um `code` ja extraido.
 *
 * A segunda forma existe porque quatro repositorios ja passavam `error.code`
 * como segundo argumento. Normalizar aqui deixa os dois formatos conviverem sem
 * exigir que todas as chamadas mudem no mesmo commit.
 */
export function normalizarCausa(causa: unknown): CausaDeFalha | undefined {
  if (typeof causa === "string") return { code: causa };
  if (typeof causa !== "object" || causa === null) return undefined;
  const { code, message, hint } = causa as Record<string, unknown>;
  const normalizada: CausaDeFalha = {};
  if (typeof code === "string") normalizada.code = code;
  if (typeof message === "string") normalizada.message = message;
  if (typeof hint === "string") normalizada.hint = hint;
  return Object.keys(normalizada).length > 0 ? normalizada : undefined;
}

/**
 * Registra a falha uma unica vez, na fronteira onde ela ainda tem contexto.
 *
 * Loga no ponto do `throw` de proposito: mais acima a causa ja virou uma classe
 * do dominio e o `code` do Postgres nao existe mais.
 */
export function registrarFalhaDeRepositorio(
  dominio: string,
  operacao: string,
  causa: CausaDeFalha | undefined,
) {
  console.error("elyra.repository_failure", {
    dominio,
    operacao,
    code: causa?.code ?? null,
    message: causa?.message ?? null,
    hint: causa?.hint ?? null,
  });
}
