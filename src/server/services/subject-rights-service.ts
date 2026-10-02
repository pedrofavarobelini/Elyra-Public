import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { assertQaOwnerDeletionAllowed } from "@/server/qa/protected-evidence";
import {
  EXPORT_SCHEMA_VERSION,
  type SubjectDataExport,
} from "@/lib/contracts/subject-rights";
import { cleanupMultimodalSession } from "@/server/services/multimodal-service";
import { revokeLearningExport } from "@/server/services/learning-service";
import { removeAllProfilePhotos } from "@/server/services/profile-photo-service";
import {
  SubjectExportRegistryError,
  readSubjectExportData,
} from "@/server/subject-export/exporter";
import { SUBJECT_EXPORT_EXCLUSIONS } from "@/server/subject-export/registry";

type Client = SupabaseClient<Database>;



export class SubjectRightsError extends Error {
  constructor(
    public readonly code: string,
    public readonly detail?: string,
  ) {
    super(`Falha no direito do titular: ${code}.`);
    this.name = "SubjectRightsError";
  }
}


export const EXCLUDED_FROM_EXPORT = SUBJECT_EXPORT_EXCLUSIONS.map(
  (descriptor) => descriptor.table,
);

/**
 * Monta a exportacao estruturada do titular.
 *
 * JSON, nao PDF: o objetivo e portabilidade real — um formato que a pessoa
 * consiga ler, versionar e levar para outro lugar. Relatorio para leitura humana
 * ja existe no proprio produto.
 */
export async function buildSubjectDataExport(
  client: Client,
  user: User,
): Promise<SubjectDataExport> {
  let data: Record<string, unknown[]>;
  try {
    data = await readSubjectExportData(client, user.id);
  } catch (error) {
    if (error instanceof SubjectExportRegistryError) {
      throw new SubjectRightsError(error.code, error.table);
    }
    throw error;
  }

  return {
    exportSchemaVersion: EXPORT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    subjectId: user.id,
    excluded: [...EXCLUDED_FROM_EXPORT],
    data,
  };
}

// ---------------------------------------------------------------------------
// Exclusao
// ---------------------------------------------------------------------------

export interface DeletionProgress {
  status: Database["public"]["Tables"]["account_deletions"]["Row"]["status"];
  learningExportsRevoked: number;
  storageObjectsRemoved: number;
  failureCode: string | null;
}

async function currentDeletion(client: Client, user: User) {
  const { data, error } = await client
    .from("account_deletions")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new SubjectRightsError("DELETION_READ_FAILED");
  return data;
}


export async function deleteAccountAndData(
  client: Client,
  user: User,
): Promise<DeletionProgress> {
  assertQaOwnerDeletionAllowed(user.id);
  const existing = await currentDeletion(client, user);

  let record = existing;
  if (!record) {
    const { data, error } = await client
      .from("account_deletions")
      .insert({ user_id: user.id, status: "requested" })
      .select("*")
      .single();
    if (error || !data) throw new SubjectRightsError("DELETION_START_FAILED");
    record = data;
  } else {
    const { data, error } = await client
      .from("account_deletions")
      .update({ attempts: Math.min(record.attempts + 1, 50), failure_code: null })
      .eq("id", record.id)
      .select("*")
      .single();
    if (error || !data) throw new SubjectRightsError("DELETION_RETRY_FAILED");
    record = data;
  }

  // --- 1. Learning ---------------------------------------------------------
  let revoked = record.learning_exports_revoked;
  if (!record.learning_revoked_at) {
    try {
      const { data: exports, error } = await client
        .from("learning_exports")
        .select("fingerprint, status")
        .eq("user_id", user.id)
        .in("status", ["eligible", "exported"]);
      if (error) throw new SubjectRightsError("LEARNING_READ_FAILED");

      for (const item of exports ?? []) {
        await revokeLearningExport(
          client,
          user,
          item.fingerprint,
          "user_data_deleted",
        );
        revoked += 1;
      }
    } catch (error) {
      await markFailure(client, record.id, "learning_revocation_failed");
      throw error;
    }

    const { data, error } = await client
      .from("account_deletions")
      .update({
        status: "learning_revoked",
        learning_revoked_at: new Date().toISOString(),
        learning_exports_revoked: revoked,
      })
      .eq("id", record.id)
      .select("*")
      .single();
    if (error || !data) throw new SubjectRightsError("DELETION_STEP_FAILED");
    record = data;
  }

  // --- 2. Storage ----------------------------------------------------------
  let removed = record.storage_objects_removed;
  if (!record.storage_cleared_at) {
    try {
      const { data: sessions, error } = await client
        .from("multimodal_sessions")
        .select("id, status")
        .eq("user_id", user.id)
        .neq("status", "deleted");
      if (error) throw new SubjectRightsError("SESSION_READ_FAILED");

      for (const session of sessions ?? []) {

        // objetos, LISTA o prefixo para confirmar ausencia e so entao limpa a
        // metadata. Reimplementar aqui criaria um segundo caminho de exclusao.
        await cleanupMultimodalSession(client, user, session.id);
        removed += 1;
      }
      removed += await removeAllProfilePhotos(client, user.id);
    } catch (error) {
      await markFailure(client, record.id, "storage_cleanup_failed");
      throw error;
    }

    const { data, error } = await client
      .from("account_deletions")
      .update({
        status: "storage_cleared",
        storage_cleared_at: new Date().toISOString(),
        storage_objects_removed: removed,
      })
      .eq("id", record.id)
      .select("*")
      .single();
    if (error || !data) throw new SubjectRightsError("DELETION_STEP_FAILED");
    record = data;
  }

  // --- 3. Dominio e conta --------------------------------------------------
  // A RPC verifica antes de apagar: se sobrou asset ou export ativo, ela recusa
  // em vez de apagar a linha e abandonar o objeto.
  const { error: finalizeError } = await client.rpc("finalize_account_deletion");
  if (finalizeError) {
    await markFailure(client, record.id, "domain_cleanup_failed");
    throw new SubjectRightsError("DELETION_FINALIZE_FAILED", finalizeError.code);
  }

  return {
    status: "domain_cleared",
    learningExportsRevoked: revoked,
    storageObjectsRemoved: removed,
    failureCode: null,
  };
}

async function markFailure(
  client: Client,
  deletionId: string,
  failureCode: NonNullable<
    Database["public"]["Tables"]["account_deletions"]["Row"]["failure_code"]
  >,
) {
  // Falha vira estado consultavel, nao excecao silenciosa: e assim que o retry
  // sabe de onde continuar.
  await client
    .from("account_deletions")
    .update({ status: "failed", failure_code: failureCode })
    .eq("id", deletionId);
}

export async function getDeletionProgress(
  client: Client,
  user: User,
): Promise<DeletionProgress | null> {
  const record = await currentDeletion(client, user);
  if (!record) return null;
  return {
    status: record.status,
    learningExportsRevoked: record.learning_exports_revoked,
    storageObjectsRemoved: record.storage_objects_removed,
    failureCode: record.failure_code,
  };
}
