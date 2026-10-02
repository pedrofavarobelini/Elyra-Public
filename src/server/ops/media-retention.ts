import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/supabase/database.types";



type Client = SupabaseClient<Database>;


export const MULTIMODAL_BUCKET = "elyra-private";

/** Estados que uma execucao de expurgo pode recolher. */
export const PURGEABLE_STATUSES = ["stored", "deleting"] as const;

export interface ExpiredAsset {
  id: string;
  user_id: string;
  session_id: string;
  storage_path: string;
  retention_until: string;
  status: string;
}

export interface PurgeOptions {
  /** Relogio injetado: o teste de fronteira precisa escolher o instante. */
  now?: Date;
  correlationId?: string;
  /** Lista o que morreria sem tocar em nada. */
  dryRun?: boolean;
  /** Teto por execucao, para o job nao virar operacao ilimitada. */
  limit?: number;
}

export interface PurgeReport {
  correlationId: string;
  now: string;
  dryRun: boolean;
  candidates: number;
  storageObjectsRemoved: number;
  metadataRemoved: number;
  failures: { assetId: string; reason: string }[];
}

/**
 * A politica de fronteira, isolada porque e a unica regra ambigua do expurgo.
 *
 * `retention_until` e o instante em que a retencao **termina**, nao o ultimo
 * instante em que ela vale. No proprio carimbo a midia ja pode ser expurgada -
 * dai `<=`. A alternativa (`<`) manteria viva, por tempo indefinido, uma midia
 * cuja retencao acabou exatamente agora, e "indefinido" porque a proxima
 * execucao so acontece quando o scheduler mandar.
 */
export function isExpired(retentionUntil: string, now: Date): boolean {
  return new Date(retentionUntil).getTime() <= now.getTime();
}

export async function findExpiredAssets(
  admin: Client,
  now: Date,
  limit: number,
): Promise<ExpiredAsset[]> {
  const { data, error } = await admin
    .from("media_assets")
    .select("id,user_id,session_id,storage_path,retention_until,status")
    .in("status", [...PURGEABLE_STATUSES])
    .lte("retention_until", now.toISOString())
    .order("retention_until", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`RETENTION_QUERY_FAILED: ${error.message}`);
  return (data ?? []) as ExpiredAsset[];
}

/**
 * Confirma que o objeto realmente saiu.
 *
 * `remove()` do Storage responde sucesso para caminho inexistente, entao a
 * resposta dele nao prova nada. A unica prova e perguntar de novo: listar o
 * diretorio e nao encontrar o nome.
 */
async function storageObjectExists(
  admin: Client,
  storagePath: string,
): Promise<boolean> {
  const at = storagePath.lastIndexOf("/");
  const prefix = at < 0 ? "" : storagePath.slice(0, at);
  const name = at < 0 ? storagePath : storagePath.slice(at + 1);
  const { data, error } = await admin.storage
    .from(MULTIMODAL_BUCKET)
    .list(prefix, { limit: 100, search: name });
  if (error) throw new Error(`STORAGE_LIST_FAILED: ${error.message}`);
  return (data ?? []).some((item) => item.name === name);
}

async function audit(
  admin: Client,
  correlationId: string,
  assetId: string,
  outcome: "success" | "failure",
) {
  // Sanitizado por construcao: nunca caminho de Storage, nunca identidade,
  // nunca conteudo. O `entity_id` e o id do asset, que ja e um identificador
  // interno - e o `actor_user_id` fica nulo porque quem age e o sistema.
  await admin.from("audit_logs").insert({
    actor_user_id: null,
    action: "media.retention_purged",
    entity_type: "media_asset",
    entity_id: assetId,
    outcome,
    correlation_id: correlationId,
  });
}

export async function purgeExpiredMedia(
  admin: Client,
  options: PurgeOptions = {},
): Promise<PurgeReport> {
  const now = options.now ?? new Date();
  const correlationId = options.correlationId ?? crypto.randomUUID();
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? 500;

  const candidates = await findExpiredAssets(admin, now, limit);
  const report: PurgeReport = {
    correlationId,
    now: now.toISOString(),
    dryRun,
    candidates: candidates.length,
    storageObjectsRemoved: 0,
    metadataRemoved: 0,
    failures: [],
  };
  if (dryRun) return report;

  for (const asset of candidates) {
    try {
      // 1. A linha declara a intencao antes de qualquer coisa sumir. Se o
      //    processo morrer da em diante, a proxima execucao encontra este
      //    estado e retoma.
      if (asset.status !== "deleting") {
        const { error } = await admin
          .from("media_assets")
          .update({ status: "deleting", deleted_at: now.toISOString() })
          .eq("id", asset.id);
        if (error) throw new Error(`METADATA_MARK_FAILED: ${error.message}`);
      }

      // 2. Storage primeiro.
      const { error: removeError } = await admin.storage
        .from(MULTIMODAL_BUCKET)
        .remove([asset.storage_path]);
      if (removeError) throw new Error(`STORAGE_REMOVE_FAILED: ${removeError.message}`);

      // 3. Confirmar ausencia. Sem esta pergunta, o passo 2 e so uma
      //    esperanca.
      if (await storageObjectExists(admin, asset.storage_path)) {
        throw new Error("STORAGE_STILL_PRESENT");
      }
      report.storageObjectsRemoved += 1;

      // 4. So agora a metadata pode sumir, porque agora ela nao esconde nada.
      const { error: deleteError } = await admin
        .from("media_assets")
        .delete()
        .eq("id", asset.id);
      if (deleteError) throw new Error(`METADATA_DELETE_FAILED: ${deleteError.message}`);
      report.metadataRemoved += 1;

      await audit(admin, correlationId, asset.id, "success");
    } catch (error) {
      // A linha continua la, em `deleting`. Falha visivel e retentavel vale
      // mais do que sucesso aparente com objeto orfao.
      report.failures.push({
        assetId: asset.id,
        reason: error instanceof Error ? error.message : "UNKNOWN",
      });
      await audit(admin, correlationId, asset.id, "failure");
    }
  }

  return report;
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * Expurga janelas de sinal e segmentos de transcricao vencidos.
 *
 * **Por que junto do expurgo de midia.** Detalhe temporal e dado intermediario
 * sensivel - "aos 14 minutos houve uma pausa longa" e qualitativamente mais
 * intimo que qualquer agregado -, e por isso recebeu a mesma retencao de 7 dias
 * da midia bruta. Dois expurgos com prazos diferentes divergiriam na primeira vez
 * que alguem ajustasse so um.
 *
 * Diferente da midia, aqui nao ha Storage: a linha **e** o dado, entao o delete
 * e suficiente e nao existe ordem a respeitar entre objeto e metadata.
 *
 * O agregado da sessao nao e tocado. Ele sobrevive por desenho: a sessao continua
 * legivel depois que o detalhe expira, exatamente como sobrevive a exclusao da
 * midia.
 */
export interface TemporalPurgeReport {
  windows: number;
  segments: number;
}

export async function purgeExpiredTemporalDetail(
  admin: Client,
  now: Date,
): Promise<TemporalPurgeReport> {
  const cutoff = now.toISOString();

  const { data: windows, error: windowsError } = await admin
    .from("session_signal_windows")
    .delete()
    .lte("retention_until", cutoff)
    .select("id");
  if (windowsError) {
    throw new Error(`WINDOWS_PURGE_FAILED: ${windowsError.message}`);
  }

  const { data: segments, error: segmentsError } = await admin
    .from("session_transcript_segments")
    .delete()
    .lte("retention_until", cutoff)
    .select("id");
  if (segmentsError) {
    throw new Error(`SEGMENTS_PURGE_FAILED: ${segmentsError.message}`);
  }

  return {
    windows: windows?.length ?? 0,
    segments: segments?.length ?? 0,
  };
}
