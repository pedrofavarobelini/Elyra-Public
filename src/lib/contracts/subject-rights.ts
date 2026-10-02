import { z } from "zod";



export const EXPORT_SCHEMA_VERSION = "elyra-subject-export/v1" as const;

export const subjectDataExportSchema = z
  .object({
    exportSchemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    generatedAt: z.string().datetime(),
    subjectId: z.string().uuid(),
    /** Declarado no proprio arquivo: o que ficou de fora, e nao por omissao. */
    excluded: z.array(z.string()).min(1),
    data: z.record(z.string(), z.array(z.unknown())),
  })
  .strict();

export type SubjectDataExport = z.infer<typeof subjectDataExportSchema>;

/**
 * Confirmacao explicita para excluir a conta.
 *
 * A frase exata evita exclusao por clique acidental ou por request forjada que
 * apenas repetisse o metodo HTTP. Nao e seguranca — e um segundo ato deliberado.
 */
export const DELETION_CONFIRMATION_PHRASE = "EXCLUIR MINHA CONTA" as const;

export const accountDeletionRequestSchema = z
  .object({
    confirmation: z.literal(DELETION_CONFIRMATION_PHRASE),
  })
  .strict();

export type AccountDeletionRequest = z.infer<
  typeof accountDeletionRequestSchema
>;

export const DELETION_STATUSES = [
  "requested",
  "learning_revoked",
  "storage_cleared",
  "domain_cleared",
  "failed",
] as const;

export type DeletionStatus = (typeof DELETION_STATUSES)[number];
