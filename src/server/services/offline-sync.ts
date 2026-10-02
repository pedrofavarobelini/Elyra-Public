import "server-only";

import { z } from "zod";

import { fingerprint } from "@/lib/offline/contracts";



export class OfflineConflictError extends Error {
  constructor(readonly current: unknown) {
    super("Este registro mudou em outro aparelho.");
    this.name = "OfflineConflictError";
  }
}

const baseSchema = z
  .object({
    baseFingerprint: z
      .string()
      .regex(/^[0-9a-f]{64}$/, "Base de sincronização inválida.")
      .nullable()
      .optional(),
  })
  .passthrough();

/**
 * Le a base de conflito do corpo bruto.
 *
 * `undefined` = cliente nao pediu checagem (uso online). `null` = a edicao
 * comecou sem registro existente neste aparelho.
 */
export function readBaseFingerprint(rawInput: unknown): string | null | undefined {
  if (typeof rawInput !== "object" || rawInput === null) return undefined;
  return baseSchema.parse(rawInput).baseFingerprint;
}

/** Remove a chave de controle antes do parse estrito do dominio. */
export function withoutSyncKeys(rawInput: unknown): unknown {
  if (typeof rawInput !== "object" || rawInput === null) return rawInput;
  const { baseFingerprint: _ignored, ...rest } = rawInput as Record<string, unknown>;
  void _ignored;
  return rest;
}

/**
 * Conflito so quando a revisao mudou **e** o servidor nao tem ja o que esta sendo
 * enviado. A segunda condicao faz o reenvio da propria escrita (ACK perdido) ser
 * neutro em vez de falso conflito.
 *
 * `currentContent`/`currentEntity`: `null` quando o registro nao existe.
 */
export async function assertNoOfflineConflict(options: {
  base: string | null | undefined;
  currentContent: unknown | null;
  currentEntity: unknown | null;
  nextContent: unknown;
}) {
  if (options.base === undefined) return;
  const current =
    options.currentContent === null ? null : await fingerprint(options.currentContent);
  if (current === options.base) return;
  if (current !== null && current === (await fingerprint(options.nextContent))) return;
  throw new OfflineConflictError(options.currentEntity);
}

/** `23505` (unique_violation) propagado pelos erros de repositorio. */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

export function conflictResponse(error: OfflineConflictError) {
  return Response.json(
    { error: error.message, conflict: error.current ?? null },
    { status: 409 },
  );
}
