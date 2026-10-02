import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "./qa-canonical-account.ts";

const QA_EMAIL_PATTERN =
  /^playwright-(?:patient-)?(?:desktop|tablet|mobile)-[a-f0-9]{14}@elyra\.invalid$/;

export function isPlaywrightQaEmail(email: string) {
  return QA_EMAIL_PATTERN.test(email);
}

/**
 * Remove somente residuos pertencentes a uma identidade sintetica de QA.
 *
 * Os catalogos custom de fatores, tags e sintomas pertencem ao profile, mas as
 * tabelas de ligacao historicas usam DELETE RESTRICT no lado do catalogo. A
 * exclusao do auth user pode tentar apagar o catalogo antes da entidade dona do
 * link. O teardown explicita a ordem sem alterar a semantica de producao.
 */
export async function cleanupQaUser(
  admin: SupabaseClient<Database>,
  userId: string,
) {
  const { data: authData, error: authError } =
    await admin.auth.admin.getUserById(userId);
  if (authError?.status === 404) return;
  if (authError) throw authError;

  const email = authData.user.email ?? "";
  /*
    A conta canonica vem primeiro, e lanca em vez de so nao casar o padrao.

    Ela nao casa `QA_EMAIL_PATTERN` hoje, entao a recusa ja aconteceria por
    outro caminho - com a mensagem errada ("identidade nao sintetica"), que
    manda quem investiga procurar um bug de geracao de e-mail. Aqui a recusa diz
    o que realmente e.
  */
  assertNotQaCanonicalAccount(email);
  if (!isPlaywrightQaEmail(email)) {
    throw new Error(
      `Cleanup QA recusado para identidade nao sintetica: ${userId}.`,
    );
  }

  // Storage nao possui FK para auth.users. Remova objetos sinteticos pelo prefixo
  // verificado antes de apagar a identidade, incluindo subpastas de sessoes.
  const folders = [userId];
  const objects: string[] = [];
  while (folders.length > 0) {
    const prefix = folders.shift();
    if (!prefix) break;
    for (let offset = 0; ; offset += 100) {
      const { data, error } = await admin.storage
        .from("elyra-private")
        .list(prefix, { limit: 100, offset });
      if (error) throw error;
      const page = data ?? [];
      for (const item of page) {
        const path = `${prefix}/${item.name}`;
        if (item.id) objects.push(path);
        else folders.push(path);
      }
      if (page.length < 100) break;
    }
  }
  if (objects.length > 0) {
    const { error } = await admin.storage.from("elyra-private").remove(objects);
    if (error) throw error;
  }

  const [checkins, entries, cycleRecords] = await Promise.all([
    admin.from("emotional_checkins").select("id").eq("user_id", userId),
    admin.from("journal_entries").select("id").eq("user_id", userId),
    admin.from("cycle_daily_records").select("id").eq("user_id", userId),
  ]);
  for (const result of [checkins, entries, cycleRecords]) {
    if (result.error) throw result.error;
  }

  const deletes = [
    ...(checkins.data?.length
      ? [
          admin
            .from("emotional_checkin_factors")
            .delete()
            .in("checkin_id", checkins.data.map((row) => row.id)),
        ]
      : []),
    ...(entries.data?.length
      ? [
          admin
            .from("journal_entry_tags")
            .delete()
            .in("entry_id", entries.data.map((row) => row.id)),
        ]
      : []),
    ...(cycleRecords.data?.length
      ? [
          admin
            .from("cycle_daily_symptoms")
            .delete()
            .in("record_id", cycleRecords.data.map((row) => row.id)),
        ]
      : []),
  ];
  const linkDeletes = await Promise.all(deletes);
  for (const result of linkDeletes) {
    if (result.error) throw result.error;
  }

  const { error: auditError } = await admin
    .from("audit_logs")
    .delete()
    .eq("actor_user_id", userId);
  if (auditError) throw auditError;

  const { error: userError } = await admin.auth.admin.deleteUser(userId);
  if (userError) throw userError;
}
