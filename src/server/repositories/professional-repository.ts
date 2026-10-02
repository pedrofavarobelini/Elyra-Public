import "server-only";

import {
  SEM_RESULTADO,
  normalizarCausa,
  registrarFalhaDeRepositorio,
} from "./repository-error";

import type { SupabaseClient } from "@supabase/supabase-js";

import { chunkIds } from "./id-chunks";

import type { Database } from "@/lib/supabase/database.types";

type Client = SupabaseClient<Database>;

export class ProfessionalRepositoryError extends Error {
  /** `code` do Postgres, quando a causa veio do PostgREST. */
  readonly code?: string;

  constructor(
    public readonly operation: string,
    causa?: unknown,
  ) {
    super(`Falha no repositorio profissional: ${operation}.`);
    this.name = "ProfessionalRepositoryError";
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("profissional", operation, normalizada);
  }
}

function failure(operation: string, code?: string) {
  return new ProfessionalRepositoryError(operation, code);
}

export async function findProfessionalProfile(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_profiles")
    .select(
      "user_id,council,council_region,registration_number,specialty,verification_status,verification_reviewed_at,verification_review_due_at,verification_updated_at,created_at,updated_at",
    )
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw failure("find_profile", error.code);
  return data;
}

export async function saveProfessionalProfile(
  client: Client,
  input: { councilRegion: string; registrationNumber: string; specialty: string },
) {
  const { data: userId, error } = await client.rpc("save_professional_credential", {
    p_council_region: input.councilRegion,
    p_registration_number: input.registrationNumber,
    p_specialty: input.specialty,
  });
  if (error) throw failure("save_profile", error.code);
  if (!userId) throw failure("save_profile", SEM_RESULTADO.code);
  const profile = await findProfessionalProfile(client, userId);
  if (!profile) throw failure("read_saved_profile");
  return profile;
}

/** Historico da propria verificacao, sem reviewer nem digest (a RPC ja corta). */
export async function listMyVerificationEvents(client: Client) {
  const { data, error } = await client.rpc("list_my_professional_verification_events");
  if (error) throw failure("list_verification_events", error.code);
  return data ?? [];
}

/** O proprio papel de reviewer. A RLS so devolve a linha de quem pergunta. */
export async function findActiveReviewer(client: Client, userId: string) {
  const { data, error } = await client
    .from("professional_reviewers")
    .select("user_id,active")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw failure("find_reviewer", error.code);
  return data?.active === true;
}

export async function listVerificationQueue(client: Client) {
  const { data, error } = await client.rpc("list_professional_verification_queue");
  if (error) throw failure("list_verification_queue", error.code);
  return data ?? [];
}

export async function reviewVerification(
  client: Client,
  input: {
    professionalUserId: string;
    toStatus: string;
    reasonCode: string;
    source: string;
    evidenceDigest?: string | null;
    validDays?: number | null;
  },
) {
  const { data, error } = await client.rpc("review_professional_verification", {
    p_professional_user_id: input.professionalUserId,
    p_to_status: input.toStatus,
    p_reason_code: input.reasonCode,
    p_source: input.source,
    p_evidence_digest: input.evidenceDigest ?? undefined,
    p_valid_days: input.validDays ?? undefined,
  });
  if (error) throw failure("review_verification", error.code);
  if (!data) throw failure("review_verification", SEM_RESULTADO.code);
  return data;
}

export async function listProfessionalConnections(client: Client) {
  const { data, error } = await client
    .from("professional_connections")
    .select(
      "id,client_user_id,professional_user_id,status,invited_at,accepted_at,paused_at,revoked_at,ended_at,updated_at",
    )
    .order("updated_at", { ascending: false });
  if (error) throw failure("list_connections", error.code);
  return data;
}

export async function respondProfessionalInvitation(
  client: Client,
  connectionId: string,
  accept: boolean,
) {
  const { data, error } = await client.rpc("respond_professional_invitation", {
    p_connection_id: connectionId,
    p_accept: accept,
  });
  if (error) throw failure("respond_invitation", error.code);
  if (!data) throw failure("respond_invitation", SEM_RESULTADO.code);
  return data;
}

export async function revokeProfessionalConnection(
  client: Client,
  connectionId: string,
) {
  const { data, error } = await client.rpc("revoke_professional_connection", {
    p_connection_id: connectionId,
  });
  if (error) throw failure("revoke_connection", error.code);
  if (!data) throw failure("revoke_connection", SEM_RESULTADO.code);
  return data;
}

export async function pauseProfessionalRelationship(client: Client, connectionId: string) {
  const { data, error } = await client.rpc("pause_professional_relationship", {
    p_connection_id: connectionId,
  });
  if (error) throw failure("pause_relationship", error.code);
  if (!data) throw failure("pause_relationship", SEM_RESULTADO.code);
  return data;
}

export async function resumeProfessionalRelationship(client: Client, connectionId: string) {
  const { data, error } = await client.rpc("resume_professional_relationship", {
    p_connection_id: connectionId,
  });
  if (error) throw failure("resume_relationship", error.code);
  if (!data) throw failure("resume_relationship", SEM_RESULTADO.code);
  return data;
}

export async function saveSharingGrantValidity(
  client: Client,
  input: {
    connectionId: string;
    scope: string;
    validFrom: string | null;
    validUntil: string | null;
    journalEntryId?: string | null;
  },
) {
  const { data, error } = await client.rpc("set_sharing_grant_validity", {
    p_connection_id: input.connectionId,
    p_scope: input.scope,
    p_valid_from: input.validFrom ?? undefined,
    p_valid_until: input.validUntil ?? undefined,
    p_journal_entry_id: input.journalEntryId ?? undefined,
  });
  if (error) throw failure("set_grant_validity", error.code);
  if (!data) throw failure("set_grant_validity", SEM_RESULTADO.code);
  return data;
}

export async function listSharingPermissions(client: Client, connectionId: string) {
  const { data, error } = await client
    .from("sharing_permissions")
    .select(
      "id,connection_id,scope,journal_entry_id,status,permission,granted_at,valid_from,expires_at,revoked_at,data_from,data_to,updated_at",
    )
    .eq("connection_id", connectionId)
    .order("scope");
  if (error) throw failure("list_permissions", error.code);
  return data;
}

export async function saveSharingPermission(
  client: Client,
  input: {
    connectionId: string;
    scope: string;
    enabled: boolean;
    journalEntryId?: string | null;
    expiresAt?: string | null;
  },
) {
  const { data, error } = await client.rpc("set_sharing_permission", {
    p_connection_id: input.connectionId,
    p_scope: input.scope,
    p_enabled: input.enabled,
    p_journal_entry_id: input.journalEntryId ?? undefined,
    p_expires_at: input.expiresAt ?? undefined,
  });
  if (error) throw failure("set_permission", error.code);
  return data;
}

/**
 * Define a janela de tempo do dado de uma permissao existente.
 *
 * RPC propria, e nao parametro novo em `set_sharing_permission`: alterar a
 * assinatura de uma funcao ja usada e mudanca de contrato disfarcada de
 * parametro opcional.
 */
export async function saveSharingDataWindow(
  client: Client,
  input: {
    connectionId: string;
    scope: string;
    dataFrom: string | null;
    dataTo: string | null;
    journalEntryId?: string | null;
  },
) {
  const { data, error } = await client.rpc("set_sharing_data_window", {
    p_connection_id: input.connectionId,
    p_scope: input.scope,
    p_data_from: input.dataFrom ?? undefined,
    p_data_to: input.dataTo ?? undefined,
    p_journal_entry_id: input.journalEntryId ?? undefined,
  });
  if (error) throw failure("set_data_window", error.code);
  return data;
}

/**
 * Registra que um profissional abriu determinados escopos de uma pessoa.
 *
 * Sem conteudo e sem identificador de registro lido: quem, qual escopo, quando.
 * Saber que o dominio emocional foi aberto as 14h e informacao do titular; saber
 * **qual** check-in foi olhado detalharia a leitura de um terceiro sem proteger
 * ninguem.
 */
export async function appendProfessionalAccess(
  client: Client,
  input: {
    connectionId: string;
    clientUserId: string;
    professionalUserId: string;
    scopes: string[];
  },
) {
  if (input.scopes.length === 0) return;
  const { error } = await client.from("professional_access_log").insert(
    input.scopes.map((scope) => ({
      connection_id: input.connectionId,
      client_user_id: input.clientUserId,
      professional_user_id: input.professionalUserId,
      scope,
    })),
  );
  if (error) throw failure("append_access_log", error.code);
}

/** A trilha que o titular le. A RLS ja garante que so a dele volta. */
export async function listProfessionalAccess(client: Client, limit: number) {
  const { data, error } = await client
    .from("professional_access_log")
    .select("id,connection_id,professional_user_id,scope,event_type,actor_role,occurred_at")
    .order("occurred_at", { ascending: false })
    .limit(limit);
  if (error) throw failure("list_access_log", error.code);
  return data;
}

export async function listProfessionalNotes(client: Client, connectionId: string) {
  const { data, error } = await client
    .from("professional_notes")
    .select("id,connection_id,professional_user_id,client_user_id,body,created_at,updated_at")
    .eq("connection_id", connectionId)
    .order("created_at", { ascending: false });
  if (error) throw failure("list_notes", error.code);
  return data;
}

export async function insertProfessionalNote(
  client: Client,
  input: {
    connectionId: string;
    professionalUserId: string;
    clientUserId: string;
    body: string;
  },
) {
  const { data, error } = await client
    .from("professional_notes")
    .insert({
      connection_id: input.connectionId,
      professional_user_id: input.professionalUserId,
      client_user_id: input.clientUserId,
      body: input.body,
    })
    .select("id,connection_id,professional_user_id,client_user_id,body,created_at,updated_at")
    .single();
  if (error) throw failure("insert_note", error.code);
  if (!data) throw failure("insert_note", SEM_RESULTADO.code);
  return data;
}

export async function updateProfessionalNote(
  client: Client,
  input: { id: string; body: string },
) {
  const { data, error } = await client
    .from("professional_notes")
    .update({ body: input.body })
    .eq("id", input.id)
    .select("id,connection_id,professional_user_id,client_user_id,body,created_at,updated_at")
    .single();
  // `PGRST116` aqui e a nota nao alcancada (inexistente ou fora do vinculo):
  // `professionalErrorResponse` ja o traduz em 403, nao em 500.
  if (error) throw failure("update_note", error.code);
  if (!data) throw failure("update_note", SEM_RESULTADO.code);
  return data;
}

export async function deleteProfessionalNote(client: Client, id: string) {
  const { data, error } = await client
    .from("professional_notes")
    .delete()
    .eq("id", id)
    .select("id")
    .single();
  if (error) throw failure("delete_note", error.code);
  if (!data) throw failure("delete_note", SEM_RESULTADO.code);
  return data;
}

export async function findAcceptedProfessionalConnection(
  client: Client,
  professionalUserId: string,
  clientUserId: string,
) {
  const { data, error } = await client
    .from("professional_connections")
    .select("id,client_user_id,professional_user_id,status,accepted_at")
    .eq("professional_user_id", professionalUserId)
    .eq("client_user_id", clientUserId)

    // nao abre dossie - e a RLS nega do mesmo jeito.
    .eq("status", "active")
    .maybeSingle();
  if (error) throw failure("find_accepted_connection", error.code);
  return data;
}

export async function findConnectedProfile(client: Client, clientUserId: string) {
  const { data, error } = await client
    .from("profiles")
    .select("user_id,display_name")
    .eq("user_id", clientUserId)
    .maybeSingle();
  if (error) throw failure("find_connected_profile", error.code);
  return data;
}

export async function readProfessionalPatientData(
  client: Client,
  clientUserId: string,
) {
  const [emotional, sleep, goals, journal, cyclePeriods, reports] = await Promise.all([
    client.from("emotional_checkins").select("id,occurred_at,mood_score,perceived_anxiety_score,energy_score,primary_feeling").eq("user_id", clientUserId).order("occurred_at", { ascending: false }).limit(90),
    client.from("sleep_records").select("id,night,duration_minutes,sleep_quality_score").eq("user_id", clientUserId).order("night", { ascending: false }).limit(90),
    client.from("goals").select("id,title,kind,status,recurrence,target,unit,created_at").eq("user_id", clientUserId).order("created_at", { ascending: false }),
    client.from("journal_entries").select("id,title,content,status,created_at,updated_at").eq("user_id", clientUserId).order("updated_at", { ascending: false }),
    client.from("cycle_periods").select("id,start_date,end_date").eq("user_id", clientUserId).order("start_date", { ascending: false }),
    client.from("report_snapshots").select("id,schema_version,analytics_version,period_start,period_end,range_days,payload,created_at").eq("user_id", clientUserId).order("created_at", { ascending: false }),
  ]);
  for (const result of [emotional, sleep, goals, journal, cyclePeriods, reports]) {
    if (result.error) throw failure("read_patient_data", result.error.code);
  }
  return {
    emotional: emotional.data ?? [],
    sleep: sleep.data ?? [],
    goals: goals.data ?? [],
    journal: journal.data ?? [],
    cyclePeriods: cyclePeriods.data ?? [],
    reports: reports.data ?? [],
  };
}

/**
 * Le o multimodal autorizado de um paciente.
 *
 * **Quem filtra e a RLS, e nao esta funcao.** Cada `select` abaixo devolve
 * exatamente o que as policies da 22B/22D permitem para este profissional, nesta
 * conexao, nesta janela. Acrescentar filtro aqui daria a impressao de que a
 * autorizacao mora na aplicacao - e um caminho que esquecesse o filtro passaria
 * a vazar. A RLS e a barreira; isto e so a leitura.
 *
 * Consequencia visivel e deliberada: interpretacao vem vazia quando o escopo de
 * IA nao foi concedido, mesmo com os sinais presentes. Os dois portoes sao
 * separados desde a 22D.
 */
export async function readProfessionalSessionData(
  client: Client,
  clientUserId: string,
) {
  const [
    sessions,
    coverage,
    features,
    windows,
    selfReports,
    interpretations,
    segments,
    transcripts,
    corrections,
  ] = await Promise.all([
      client
        .from("multimodal_sessions")
        /*
          `visual_analysis_consent` acompanha a sessao para o relatorio poder
          distinguir "nao houve sinal visual" de "a analise visual nem foi
          autorizada". Sem ele, a ausencia da secao seria ambigua exatamente onde
          a ambiguidade custa mais: o profissional suporia que se olhou e nao se
          achou nada.
        */
        .select("id,kind,status,started_at,ended_at,visual_analysis_consent")
        .eq("user_id", clientUserId)
        .order("started_at", { ascending: false })
        .limit(50),
      client
        .from("session_modality_coverage")
        .select("session_id,modality,outcome,reason,coverage_ms,session_duration_ms")
        .eq("user_id", clientUserId),
      client
        .from("derived_features")
        // Literal unico: o cliente tipado do Supabase deriva o tipo da string, e
        // uma concatenacao vira `string` opaco - o retorno perderia o tipo.
        .select("session_id,signal_name,unit,value,status,personal_baseline_mean,personal_baseline_samples,delta_vs_personal_baseline,coverage_ms,coverage_outcome")
        .eq("user_id", clientUserId),
      client
        .from("session_signal_windows")
        .select("session_id,signal_name,start_offset_ms,end_offset_ms,value")
        .eq("user_id", clientUserId)
        .order("start_offset_ms", { ascending: true }),
      client
        .from("session_self_reports")
        .select("session_id,mood,perceived_anxiety,energy")
        .eq("user_id", clientUserId),
      client
        .from("session_interpretations")
        .select("session_id,confidence,provider_used,model,payload,created_at")
        .eq("user_id", clientUserId)
        .order("created_at", { ascending: false }),
      client
        .from("session_transcript_segments")
        .select("session_id,segment_index,content,start_offset_ms,recognized_at_offset_ms")
        .eq("user_id", clientUserId)
        .order("segment_index", { ascending: true }),
      /*
        Proveniencia da transcricao.

        O profissional precisa saber que esta lendo saida de reconhecimento
        automatico, e nao uma transcricao literal. Sem isso, um erro de ASR
        chega como fala da pessoa - e a diferenca entre "ela disse" e "a maquina
        entendeu" e exatamente o tipo de coisa sobre a qual alguem decide.
      */
      client
        .from("session_transcripts")
        .select("session_id,source,status")
        .eq("user_id", clientUserId),
      /*
        Correcoes NAO revogadas.

        Se a pessoa corrigiu, mostrar o texto que o ASR errou e esconder a
        correcao dela seria pior que nao mostrar nada: o profissional leria como
        fala o que a propria pessoa ja disse que nao foi dito. A RLS ja limita
        isto ao que foi compartilhado.
      */
      client
        .from("transcript_corrections")
        .select("session_id,revision,corrected_content,created_at")
        .eq("user_id", clientUserId)
        .is("revoked_at", null)
        .order("revision", { ascending: false }),
    ]);

  for (const result of [
    sessions,
    coverage,
    features,
    windows,
    selfReports,
    interpretations,
    segments,
    transcripts,
    corrections,
  ]) {
    if (result.error) throw failure("read_session_data", result.error.code);
  }

  return {
    sessions: sessions.data ?? [],
    coverage: coverage.data ?? [],
    features: features.data ?? [],
    windows: windows.data ?? [],
    selfReports: selfReports.data ?? [],
    interpretations: interpretations.data ?? [],
    segments: segments.data ?? [],
    transcripts: transcripts.data ?? [],
    corrections: corrections.data ?? [],
  };
}

// ---------------------------------------------------------------------------

//
// O token bruto so existe no retorno de `create_professional_invite` e no corpo
// do pedido de resgate. Este modulo nunca o registra: `failure` recebe apenas o
// `code` do Postgres.
// ---------------------------------------------------------------------------

export async function createProfessionalInvite(client: Client) {
  const { data, error } = await client.rpc("create_professional_invite");
  if (error) throw failure("create_invite", error.code);
  const created = data?.[0];
  if (!created) throw failure("create_invite", SEM_RESULTADO.code);
  return created;
}

export async function listMyProfessionalInvites(client: Client) {
  const { data, error } = await client.rpc("list_my_professional_invites");
  if (error) throw failure("list_invites", error.code);
  return data ?? [];
}

export async function revokeProfessionalInvite(client: Client, inviteId: string) {
  const { data, error } = await client.rpc("revoke_professional_invite", {
    p_invite_id: inviteId,
  });
  if (error) throw failure("revoke_invite", error.code);
  if (!data) throw failure("revoke_invite", SEM_RESULTADO.code);
  return data;
}

/** Vazio significa "indisponivel" - o banco nao diz por que, de proposito. */
export async function previewProfessionalInvite(client: Client, token: string) {
  const { data, error } = await client.rpc("preview_professional_invite", {
    p_token: token,
  });
  if (error) throw failure("preview_invite", error.code);
  return data?.[0] ?? null;
}

/**
 * Aceite com resultado decidido no banco (L-435). `null` = indisponivel, sem
 * dizer por que; o proprio titular que repete um aceite recebe
 * `already_accepted`.
 */
export async function acceptProfessionalInvite(client: Client, token: string) {
  const { data, error } = await client.rpc("accept_professional_invite_code", {
    p_token: token,
  });
  if (error) throw failure("accept_invite", error.code);
  return data?.[0] ?? null;
}

export async function declineProfessionalInvite(client: Client, token: string) {
  const { data, error } = await client.rpc("decline_professional_invite", {
    p_token: token,
  });
  if (error) throw failure("decline_invite", error.code);
  return data === true;
}

// ---------------------------------------------------------------------------

//
// Tudo aqui e metadado de vinculo e de grant: nenhuma leitura de diario,
// transcricao, midia ou payload de relatorio. A RLS decide o que volta.
// ---------------------------------------------------------------------------

/** Vinculos em que a conta e o **profissional** (nao os em que e titular). */
export async function listRelationshipsAsProfessional(
  client: Client,
  professionalUserId: string,
) {
  const { data, error } = await client
    .from("professional_connections")
    .select(
      "id,client_user_id,status,invited_by_user_id,invited_at,accepted_at,paused_at,revoked_at,ended_at,updated_at,origin_invite_id",
    )
    .eq("professional_user_id", professionalUserId)
    .order("updated_at", { ascending: false });
  if (error) throw failure("list_relationships", error.code);
  return data ?? [];
}

/**
 * Nomes visiveis. A policy `profiles_select_connected_professional` so devolve
 * titular de vinculo **ativo** com profissional verificado: pausado, encerrado
 * ou pendente volta sem nome, e a tela precisa dizer isso.
 */
export async function listVisibleClientNames(client: Client, clientUserIds: string[]) {
  const names = new Map<string, string>();
  for (const ids of chunkIds([...new Set(clientUserIds)])) {
    const { data, error } = await client
      .from("profiles")
      .select("user_id,display_name")
      .in("user_id", ids);
    if (error) throw failure("list_client_names", error.code);
    for (const row of data ?? []) names.set(row.user_id, row.display_name);
  }
  return names;
}

export async function listGrantsForRelationships(client: Client, connectionIds: string[]) {
  const rows = [];
  for (const ids of chunkIds(connectionIds)) {
    const { data, error } = await client
      .from("sharing_permissions")
      .select(
        "id,connection_id,scope,journal_entry_id,status,permission,granted_at,valid_from,expires_at,revoked_at,data_from,data_to,updated_at",
      )
      .in("connection_id", ids);
    if (error) throw failure("list_grants", error.code);
    rows.push(...(data ?? []));
  }
  return rows;
}

/** Periodo para comparacao em Relatorios: so colunas numericas e data. */
export async function readEmotionalSeries(
  client: Client,
  clientUserId: string,
  sinceIso: string,
) {
  const { data, error } = await client
    .from("emotional_checkins")
    .select("occurred_at,mood_score,perceived_anxiety_score,energy_score")
    .eq("user_id", clientUserId)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: true })
    .limit(2000);
  if (error) throw failure("read_emotional_series", error.code);
  return data ?? [];
}

export async function readSleepSeries(client: Client, clientUserId: string, sinceDate: string) {
  const { data, error } = await client
    .from("sleep_records")
    .select("night,duration_minutes,sleep_quality_score")
    .eq("user_id", clientUserId)
    .gte("night", sinceDate)
    .order("night", { ascending: true })
    .limit(2000);
  if (error) throw failure("read_sleep_series", error.code);
  return data ?? [];
}

/** Metadados de snapshots; o payload so e lido no detalhe. */
export async function listReportSnapshotMeta(client: Client, clientUserId: string) {
  const { data, error } = await client
    .from("report_snapshots")
    .select("id,period_start,period_end,range_days,schema_version,analytics_version,created_at")
    .eq("user_id", clientUserId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw failure("list_report_snapshots", error.code);
  return data ?? [];
}

export async function findReportSnapshot(client: Client, clientUserId: string, snapshotId: string) {
  const { data, error } = await client
    .from("report_snapshots")
    .select("id,period_start,period_end,range_days,schema_version,analytics_version,payload,created_at")
    .eq("user_id", clientUserId)
    .eq("id", snapshotId)
    .maybeSingle();
  if (error) throw failure("find_report_snapshot", error.code);
  return data;
}

/** Leituras de IA existentes no periodo - so metadados, nunca o texto. */
export async function listInterpretationMeta(client: Client, clientUserId: string, sinceIso: string) {
  const { data, error } = await client
    .from("session_interpretations")
    .select("session_id,confidence,created_at")
    .eq("user_id", clientUserId)
    .gte("created_at", sinceIso)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw failure("list_interpretations", error.code);
  return data ?? [];
}

/**
 * Fluxo B: a pessoa pede acompanhamento pelo slug da descoberta. O banco
 * resolve o slug com a mesma elegibilidade da descoberta, aplica o
 * anti-abuso e cria (ou reabre) a MESMA relationship do fluxo A.
 */
export async function requestProfessionalConnection(client: Client, slug: string) {
  const { data, error } = await client.rpc("request_professional_connection", { p_slug: slug });
  if (error) {
    // Recusa por regra: nunca registrar como falha de infraestrutura.
    if (error.message === "professional_unavailable") return { outcome: "unavailable" as const };
    if (error.message === "request_limit") return { outcome: "limit" as const };
    throw failure("request_connection", error.code);
  }
  const row = data?.[0];
  if (!row) throw failure("request_connection", SEM_RESULTADO.code);
  return { outcome: "ok" as const, connectionId: row.connection_id, status: row.status };
}

export async function findMyConnectionForDirectorySlug(client: Client, slug: string) {
  const { data, error } = await client.rpc("my_connection_for_directory_slug", { p_slug: slug });
  if (error) throw failure("directory_connection", error.code);
  const row = data?.[0];
  return row ? { connectionId: row.connection_id, status: row.status } : null;
}

export async function listMyConnectionProfessionalNames(client: Client) {
  const { data, error } = await client.rpc("list_my_connection_professional_names");
  if (error) throw failure("connection_names", error.code);
  return new Map((data ?? []).map((row) => [row.connection_id, row.professional_name ?? null]));
}
