import { z } from "zod";

/**
 * Contratos V1 do diario.
 *
 * Privado por padrao. Sem historico completo de versoes na V1.
 * Lixeira de 30 dias + exclusao permanente explicita.
 */

export const journalStatusSchema = z.enum(["draft", "saved"]);
export type JournalStatus = z.infer<typeof journalStatusSchema>;

export const journalTagSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1).max(30),
  origin: z.enum(["system", "custom"]),
  ownerId: z.string().min(1).nullable(),
});

export type JournalTag = z.infer<typeof journalTagSchema>;

export const journalEntrySchema = z.object({
  id: z.string().min(1),
  title: z.string().max(120),
  content: z.string(),
  status: journalStatusSchema,
  tagIds: z.array(z.string().min(1)),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  /** Preenchido quando a entrada esta na lixeira. Retencao de 30 dias. */
  trashedAt: z.string().datetime({ offset: true }).nullable(),
});

export type JournalEntry = z.infer<typeof journalEntrySchema>;

export const journalEntryInputSchema = journalEntrySchema.pick({
  title: true,
  content: true,
  tagIds: true,
});

export type JournalEntryInput = z.infer<typeof journalEntryInputSchema>;

export const journalSaveInputSchema = journalEntryInputSchema.extend({
  id: z.string().uuid().optional(),
  status: journalStatusSchema.default("draft"),
});

export type JournalSaveInput = z.infer<typeof journalSaveInputSchema>;

export const customJournalTagInputSchema = z.object({
  label: z.string().trim().min(1, "Informe uma tag.").max(30),
});

export const journalEntryActionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["trash", "restore"]),
});

export const journalEntryDeleteSchema = z.object({ id: z.string().uuid() });

export interface JournalSnapshot {
  entries: JournalEntry[];
  tags: JournalTag[];
}

/** Retencao da lixeira, em dias. Fonte: baseline v0.6 secao 14.1. */
export const TRASH_RETENTION_DAYS = 30;

/** Dias restantes ate o expurgo. `null` quando a entrada nao esta na lixeira. */
export function daysUntilPurge(
  trashedAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!trashedAt) return null;
  const elapsedMs = now.getTime() - new Date(trashedAt).getTime();
  const elapsedDays = Math.floor(elapsedMs / 86_400_000);
  return Math.max(0, TRASH_RETENTION_DAYS - elapsedDays);
}
