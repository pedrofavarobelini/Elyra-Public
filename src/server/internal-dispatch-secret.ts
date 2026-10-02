import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Segredo das rotas de sistema (ADR-0023).
 *
 * - `ELYRA_DISPATCH_SECRET` com menos de 32 caracteres conta como ausente: um
 *   segredo curto num endpoint que age por muitos titulares e adivinhavel.
 * - Ausente, a rota se comporta como inexistente (404), e o canal e-mail nunca
 *   fica disponivel porque o dispatcher nunca registra execucao.
 * - A comparacao e de digests em tempo constante: nem o tamanho nem o prefixo
 *   do segredo vazam pelo tempo de resposta.
 * - O segredo nunca entra em log, resposta ou erro.
 */
export const MIN_DISPATCH_SECRET_LENGTH = 32;

export type DispatchSecretEnvironment = Readonly<Record<string, string | undefined>>;

export function dispatchSecretConfigured(env: DispatchSecretEnvironment = process.env): boolean {
  return (env.ELYRA_DISPATCH_SECRET?.trim().length ?? 0) >= MIN_DISPATCH_SECRET_LENGTH;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function requireInternalDispatchSecret(
  authorization: string | null,
  env: DispatchSecretEnvironment = process.env,
): boolean {
  if (!dispatchSecretConfigured(env)) return false;
  const expected = env.ELYRA_DISPATCH_SECRET!.trim();
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  const provided = match?.[1]?.trim() ?? "";
  // Digests de tamanho fixo: `timingSafeEqual` exige buffers iguais em tamanho.
  return timingSafeEqual(digest(provided), digest(expected));
}
