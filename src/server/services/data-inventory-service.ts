import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  buildDataInventory,
  type DataInventory,
} from "@/lib/contracts/data-inventory";
import type { Database } from "@/lib/supabase/database.types";
import { readSubjectExportData } from "@/server/subject-export/exporter";
import { SUBJECT_EXPORT_EXCLUSIONS } from "@/server/subject-export/registry";

type Client = SupabaseClient<Database>;

/**
 * "O que existe sobre mim", contado a partir da mesma fonte do export.
 *
 * ## Por que reusar o leitor do export
 *
 * Porque ele e dirigido pelo registro que o guarda de cobertura mantem completo.
 * Qualquer tabela publica nova precisa ser classificada — incluida ou excluida —
 * antes de a suite passar. O inventario herda essa garantia: ele nao pode
 * esquecer um dominio sem que um teste reprove primeiro.
 *
 * ## O custo, declarado
 *
 * Contar assim significa **ler as linhas** para conta-las, com o client RLS da
 * propria pessoa. Para um titular isso e barato: o volume e humano, nao
 * analitico. Se algum dia deixar de ser, a otimizacao correta e um leitor de
 * contagem que reuse as **mesmas** estrategias de posse do registro — e nao uma
 * segunda lista de tabelas, que divergiria na primeira mudanca.
 */
export async function getDataInventory(
  client: Client,
  user: User,
): Promise<DataInventory> {
  const data = await readSubjectExportData(client, user.id);
  return buildDataInventory(
    data,
    SUBJECT_EXPORT_EXCLUSIONS.map((descriptor) => descriptor.table),
  );
}
