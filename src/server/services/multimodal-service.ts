import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import {
  CAPTURE_RESOURCES,
  mediaAssetSchema,
  multimodalSessionDetailSchema,
  multimodalSessionSchema,
  sessionCreateSchema,
  sessionStatusUpdateSchema,
  type CaptureResource,
  MAX_MEDIA_BYTES,
} from "@/lib/contracts/session";
import type { Database } from "@/lib/supabase/database.types";
import { assertQaEvidenceMutationAllowed } from "@/server/qa/protected-evidence";
import {
  cancelActiveSessionJobs,
  deleteMediaAsset,
  deleteSessionAssets,
  findMediaAsset,
  findMultimodalSession,
  findMultimodalSessions,
  findSessionAssets,
  insertMediaAsset,
  insertMultimodalSession,
  insertProcessingJob,
  updateMediaAsset,
  updateMultimodalSession,
  updateProcessingJob,
} from "@/server/repositories/multimodal-repository";

type Client = SupabaseClient<Database>;
type SessionRow = Database["public"]["Tables"]["multimodal_sessions"]["Row"];
type AssetRow = Database["public"]["Tables"]["media_assets"]["Row"];

export const MULTIMODAL_BUCKET = "elyra-private";
/*
  Reexportado, e nao redefinido: o teto vive no contrato porque o mesmo numero
  governa o Zod do asset e o `check` do banco. Duas copias divergiriam na
  primeira vez que alguem ajustasse uma delas - foi assim que 5 MB e 60 minutos
  passaram a se contradizer.
*/
export { MAX_MEDIA_BYTES };
export const SIGNED_URL_TTL_SECONDS = 60;

export class MultimodalServiceError extends Error {
  constructor(
    public readonly code:
      | "SESSION_NOT_FOUND"
      | "ASSET_NOT_FOUND"
      | "INVALID_STATE"
      | "INVALID_MEDIA"
      | "STORAGE_FAILED"
      | "CLEANUP_INCOMPLETE",
  ) {
    super(code);
    this.name = "MultimodalServiceError";
  }
}

const uploadMetadataSchema = z.object({
  sessionId: z.string().uuid(),
  mediaKind: z.enum(CAPTURE_RESOURCES),
  durationMs: z.coerce.number().int().min(0).max(3_600_000).nullable(),
});

function toSetup(row: SessionRow) {
  return {
    kind: row.kind,
    screen: row.screen_consent,
    camera: row.camera_consent,
    microphone: row.microphone_consent,
    transcribe: row.transcription_consent,
    visualAnalysis: row.visual_analysis_consent,
    keepRecording: row.storage_consent,
    aiAnalysis: row.ai_analysis_consent,
    shareResult: row.share_result_consent,
    shareTranscript: row.share_transcript_consent,
    shareRecording: row.share_original_consent,
    trainingEligible: row.training_eligibility_consent,
  };
}

function toAsset(row: AssetRow) {
  return mediaAssetSchema.parse({
    id: row.id,
    sessionId: row.session_id,
    mediaKind: row.media_kind,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes),
    durationMs: row.duration_ms,
    checksumSha256: row.checksum_sha256,
    retentionUntil: row.retention_until,
    status: row.status,
  });
}

function toSummary(row: SessionRow) {
  const resources = CAPTURE_RESOURCES.filter((resource) =>
    resource === "screen"
      ? row.screen_consent
      : resource === "camera"
        ? row.camera_consent
        : row.microphone_consent,
  );
  const durationMinutes = row.ended_at
    ? Math.max(
        0,
        Math.round(
          (Date.parse(row.ended_at) - Date.parse(row.started_at)) / 60_000,
        ),
      )
    : null;
  return multimodalSessionSchema.parse({
    id: row.id,
    kind: row.kind,
    startedAt: row.started_at,
    durationMinutes,
    status: row.status,
    resources,
  });
}

async function toDetail(client: Client, row: SessionRow) {
  const assets = await findSessionAssets(client, row.id);
  return multimodalSessionDetailSchema.parse({
    id: row.id,
    kind: row.kind,
    status: row.status,
    setup: toSetup(row),
    startedAt: row.started_at,
    endedAt: row.ended_at,
    assets: assets.map(toAsset),
  });
}

/**
 * Sessao "presa" (OFF-3, L-407): a aba fechou (ou a rede caiu e nao voltou)
 * antes de `completed`, e a sessao ficaria `capturing`/`paused` para sempre.
 * Nenhuma captura dura mais que `MAX_SESSION_MS` (1 h); depois de 6 h do inicio
 * ela nao pode mais continuar. O reparo e preguicoso, na leitura, pelo proprio
 * dono (RLS): vira `error` ("Falha de captura"), transicao que o banco ja
 * permite. Sem cron. Se a atualizacao nao for permitida (outro leitor, evidencia
 * protegida de QA), a linha volta como esta.
 */
export const STALE_SESSION_MS = 6 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["preparing", "capturing", "paused"]);

export function isStaleSession(row: { status: string; started_at: string }, now = Date.now()) {
  if (!OPEN_STATUSES.has(row.status)) return false;
  const started = Date.parse(row.started_at);
  return Number.isFinite(started) && now - started > STALE_SESSION_MS;
}

async function repairStale<T extends { id: string; status: string; started_at: string }>(client: Client, row: T): Promise<T> {
  if (!isStaleSession(row)) return row;
  try {
    assertQaEvidenceMutationAllowed(row.id);
    return (await updateMultimodalSession(client, row.id, { status: "error", ended_at: new Date().toISOString() })) as unknown as T;
  } catch {
    return row;
  }
}

export async function listMultimodalSessions(client: Client, user: User) {
  const rows = await findMultimodalSessions(client, user.id);
  return (await Promise.all(rows.map((row) => repairStale(client, row)))).map(toSummary);
}

export async function getMultimodalSession(
  client: Client,
  sessionId: string,
) {
  const found = await findMultimodalSession(client, z.string().uuid().parse(sessionId));
  if (!found || found.status === "deleted") {
    throw new MultimodalServiceError("SESSION_NOT_FOUND");
  }
  const row = await repairStale(client, found);
  return toDetail(client, row);
}

export async function createMultimodalSession(
  client: Client,
  user: User,
  rawInput: unknown,
) {
  const input = sessionCreateSchema.parse(rawInput);
  // PRO-7: captura ligada a uma sessao profissional. O banco confere dono,
  // sessao ativa e cada consentimento (gatilho); aqui so a forma.
  const link = z
    .object({ professionalSessionId: z.string().uuid().optional() })
    .passthrough()
    .parse(rawInput ?? {});
  const row = await insertMultimodalSession(client, {
    user_id: user.id,
    professional_session_id: link.professionalSessionId ?? null,
    kind: input.kind,
    screen_consent: input.screen,
    camera_consent: input.camera,
    microphone_consent: input.microphone,
    transcription_consent: input.transcribe,
    visual_analysis_consent: input.visualAnalysis,
    storage_consent: input.keepRecording,
    ai_analysis_consent: input.aiAnalysis,
    share_result_consent: input.shareResult,
    share_transcript_consent: input.shareTranscript,
    share_original_consent: input.shareRecording,
    training_eligibility_consent: input.trainingEligible,
  });
  return toDetail(client, row);
}

export async function setMultimodalSessionStatus(
  client: Client,
  sessionId: string,
  rawInput: unknown,
) {
  const id = z.string().uuid().parse(sessionId);
  const input = sessionStatusUpdateSchema.parse(rawInput);
  const current = await findMultimodalSession(client, id);
  if (!current) throw new MultimodalServiceError("SESSION_NOT_FOUND");
  assertQaEvidenceMutationAllowed(current.id);
  const ended = ["completed", "cancelled", "error"].includes(input.status);
  const row = await updateMultimodalSession(client, id, {
    status: input.status,
    ...(ended && !current.ended_at ? { ended_at: new Date().toISOString() } : {}),
  });
  return toDetail(client, row);
}

function normalizeMime(value: string) {
  return value.toLowerCase().split(";", 1)[0]?.trim() ?? "";
}

function sniffContainer(bytes: Uint8Array): "webm" | "ogg" | "mp4" | null {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x1a &&
    bytes[1] === 0x45 &&
    bytes[2] === 0xdf &&
    bytes[3] === 0xa3
  ) return "webm";
  if (bytes.length >= 4 && new TextDecoder().decode(bytes.slice(0, 4)) === "OggS") {
    return "ogg";
  }
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp") {
    return "mp4";
  }
  return null;
}

function validateMedia(
  bytes: Uint8Array,
  declaredMime: string,
  kind: CaptureResource,
) {
  if (bytes.length < 4 || bytes.length > MAX_MEDIA_BYTES) {
    throw new MultimodalServiceError("INVALID_MEDIA");
  }
  const mime = normalizeMime(declaredMime);
  const allowed = kind === "microphone"
    ? ["audio/webm", "audio/ogg", "audio/mp4"]
    : ["video/webm", "video/mp4"];
  if (!allowed.includes(mime)) throw new MultimodalServiceError("INVALID_MEDIA");
  const container = sniffContainer(bytes);
  if (
    (container === "webm" && mime.endsWith("/webm")) ||
    (container === "ogg" && mime === "audio/ogg") ||
    (container === "mp4" && mime.endsWith("/mp4"))
  ) return mime as AssetRow["mime_type"];
  throw new MultimodalServiceError("INVALID_MEDIA");
}

function extensionForMime(mime: string) {
  if (mime.endsWith("/webm")) return "webm";
  if (mime === "audio/ogg") return "ogg";
  return "mp4";
}

async function sha256(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) =>
    value.toString(16).padStart(2, "0"),
  ).join("");
}

export async function uploadMultimodalAsset(
  client: Client,
  user: User,
  rawMetadata: unknown,
  file: File,
) {
  const metadata = uploadMetadataSchema.parse(rawMetadata);
  const session = await findMultimodalSession(client, metadata.sessionId);
  if (!session) throw new MultimodalServiceError("SESSION_NOT_FOUND");
  if (session.user_id !== user.id || !["capturing", "paused"].includes(session.status)) {
    throw new MultimodalServiceError("INVALID_STATE");
  }
  const consent = metadata.mediaKind === "screen"
    ? session.screen_consent
    : metadata.mediaKind === "camera"
      ? session.camera_consent
      : session.microphone_consent;
  if (!session.storage_consent || !consent) {
    throw new MultimodalServiceError("INVALID_STATE");
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = validateMedia(bytes, file.type, metadata.mediaKind);
  const id = crypto.randomUUID();
  const path = `${user.id}/multimodal/${session.id}/${id}.${extensionForMime(mime)}`;
  const asset = await insertMediaAsset(client, {
    id,
    session_id: session.id,
    user_id: user.id,
    media_kind: metadata.mediaKind,
    storage_path: path,
    mime_type: mime,
    size_bytes: bytes.length,
    duration_ms: metadata.durationMs,
    checksum_sha256: await sha256(bytes),
  });
  const startedAt = new Date().toISOString();
  const job = await insertProcessingJob(client, {
    session_id: session.id,
    media_asset_id: asset.id,
    user_id: user.id,
    job_kind: "upload_finalize",
    status: "running",
    attempts: 1,
    started_at: startedAt,
  });

  const { error } = await client.storage
    .from(MULTIMODAL_BUCKET)
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (error) {
    await client.storage.from(MULTIMODAL_BUCKET).remove([path]);
    await updateMediaAsset(client, asset.id, { status: "interrupted" });
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: "storage_upload_failed",
    });
    throw new MultimodalServiceError("STORAGE_FAILED");
  }

  const stored = await updateMediaAsset(client, asset.id, { status: "stored" });
  await updateProcessingJob(client, job.id, {
    status: "succeeded",
    finished_at: new Date().toISOString(),
    error_code: null,
  });
  return toAsset(stored);
}

async function listSessionObjects(client: Client, userId: string, sessionId: string) {
  const prefix = `${userId}/multimodal/${sessionId}`;
  const names: string[] = [];
  for (let offset = 0; ; offset += 100) {
    const { data, error } = await client.storage
      .from(MULTIMODAL_BUCKET)
      .list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new MultimodalServiceError("STORAGE_FAILED");
    const page = data ?? [];
    names.push(...page.map((item) => `${prefix}/${item.name}`));
    if (page.length < 100) break;
  }
  return names;
}

export async function cleanupMultimodalSession(
  client: Client,
  user: User,
  sessionId: string,
) {
  const id = z.string().uuid().parse(sessionId);
  const session = await findMultimodalSession(client, id);
  if (!session || session.user_id !== user.id) {
    throw new MultimodalServiceError("SESSION_NOT_FOUND");
  }
  assertQaEvidenceMutationAllowed(session.id, session.user_id);
  await cancelActiveSessionJobs(client, id);
  const now = new Date().toISOString();
  const job = await insertProcessingJob(client, {
    session_id: id,
    user_id: user.id,
    job_kind: "media_cleanup",
    status: "running",
    attempts: 1,
    started_at: now,
  });

  try {
    if (session.status !== "deleted" && session.status !== "cleanup_pending") {
      await updateMultimodalSession(client, id, { status: "cleanup_pending" });
    }
    const assets = await findSessionAssets(client, id);
    for (const asset of assets) {
      if (asset.status !== "deleting") {
        await updateMediaAsset(client, asset.id, {
          status: "deleting",
          deleted_at: now,
        });
      }
    }
    const paths = new Set([
      ...assets.map((asset) => asset.storage_path),
      ...(await listSessionObjects(client, user.id, id)),
    ]);
    if (paths.size > 0) {
      const { error } = await client.storage
        .from(MULTIMODAL_BUCKET)
        .remove([...paths]);
      if (error) throw new MultimodalServiceError("STORAGE_FAILED");
    }
    if ((await listSessionObjects(client, user.id, id)).length > 0) {
      throw new MultimodalServiceError("CLEANUP_INCOMPLETE");
    }
    await deleteSessionAssets(client, id);
    if (session.status !== "deleted") {
      await updateMultimodalSession(client, id, {
        status: "deleted",
        ended_at: session.ended_at ?? now,
      });
    }
    await updateProcessingJob(client, job.id, {
      status: "succeeded",
      finished_at: new Date().toISOString(),
      error_code: null,
    });
    return { id, status: "deleted" as const, storageObjects: 0, mediaAssets: 0 };
  } catch (error) {
    await updateProcessingJob(client, job.id, {
      status: "failed",
      finished_at: new Date().toISOString(),
      error_code: error instanceof MultimodalServiceError
        ? error.code.toLowerCase()
        : "cleanup_failed",
    });
    throw error;
  }
}

export async function createMultimodalAssetSignedUrl(
  client: Client,
  assetId: string,
) {
  const id = z.string().uuid().parse(assetId);
  const asset = await findMediaAsset(client, id);
  if (!asset || asset.status !== "stored") {
    throw new MultimodalServiceError("ASSET_NOT_FOUND");
  }
  const { data, error } = await client.storage
    .from(MULTIMODAL_BUCKET)
    .createSignedUrl(asset.storage_path, SIGNED_URL_TTL_SECONDS);
  if (error || !data.signedUrl) {
    throw new MultimodalServiceError("STORAGE_FAILED");
  }
  return { url: data.signedUrl, expiresIn: SIGNED_URL_TTL_SECONDS };
}


export async function deleteMultimodalAsset(
  client: Client,
  user: User,
  assetId: string,
) {
  const id = z.string().uuid().parse(assetId);
  const asset = await findMediaAsset(client, id);
  // A RLS ja restringe a leitura ao dono; a checagem aqui distingue "nao existe"
  // de "existe e nao e seu" sem contar qual dos dois e.
  if (!asset) throw new MultimodalServiceError("ASSET_NOT_FOUND");
  assertQaEvidenceMutationAllowed(asset.session_id, asset.user_id);

  const previousStatus = asset.status;
  await updateMediaAsset(client, id, {
    status: "deleting",
    deleted_at: new Date().toISOString(),
  });

  try {
    const { error } = await client.storage
      .from(MULTIMODAL_BUCKET)
      .remove([asset.storage_path]);
    if (error) throw new MultimodalServiceError("STORAGE_FAILED");

    const remaining = await listSessionObjects(client, user.id, asset.session_id);
    if (remaining.includes(asset.storage_path)) {
      throw new MultimodalServiceError("CLEANUP_INCOMPLETE");
    }

    await deleteMediaAsset(client, id);
    return { id, sessionId: asset.session_id, status: "deleted" as const };
  } catch (error) {
    /*
      O metadado volta ao estado anterior: um asset preso em `deleting` com o
      objeto ainda no bucket seria pior que o erro — a tela diria que a gravacao
      foi apagada, e ela continuaria la.
    */
    await updateMediaAsset(client, id, {
      status: previousStatus,
      deleted_at: null,
    });
    throw error;
  }
}
