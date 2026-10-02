import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";
import { z } from "zod";

import {
  professionalConnectionActionSchema,
  professionalNoteInputSchema,
  professionalNoteUpdateSchema,
  sharingDataWindowInputSchema,
  grantIsCurrent,
  sharingGrantValidityInputSchema,
  sharingPermissionInputSchema,
} from "@/lib/contracts/sharing";
import { inviteRedeemInputSchema, type InviteAcceptOutcome } from "@/lib/contracts/professional-invites";
import type {
  PortalGrant,
  PortalInvite,
  PortalRelationship,
  PortalVerification,
} from "@/lib/professional/portal";
import {
  effectiveVerificationStatus,
  professionalCredentialInputSchema,
  verificationReviewInputSchema,
} from "@/lib/contracts/professional-verification";
import type { Database } from "@/lib/supabase/database.types";
import { buildAnalyticsReport } from "@/lib/reports";
import {
  acceptProfessionalInvite,
  createProfessionalInvite,
  declineProfessionalInvite,
  listMyProfessionalInvites,
  listGrantsForRelationships,
  findReportSnapshot,
  listInterpretationMeta,
  listReportSnapshotMeta,
  readEmotionalSeries,
  readSleepSeries,
  listRelationshipsAsProfessional,
  listVisibleClientNames,
  previewProfessionalInvite,
  revokeProfessionalInvite,
  deleteProfessionalNote,
  findAcceptedProfessionalConnection,
  findConnectedProfile,
  findActiveReviewer,
  findProfessionalProfile,
  insertProfessionalNote,
  listProfessionalConnections,
  listMyVerificationEvents,
  listProfessionalNotes,
  listVerificationQueue,
  listSharingPermissions,
  readProfessionalPatientData,
  readProfessionalSessionData,
  respondProfessionalInvitation,
  requestProfessionalConnection,
  findMyConnectionForDirectorySlug,
  listMyConnectionProfessionalNames,
  pauseProfessionalRelationship,
  resumeProfessionalRelationship,
  saveSharingGrantValidity,
  reviewVerification,
  revokeProfessionalConnection,
  saveProfessionalProfile,
  appendProfessionalAccess,
  listProfessionalAccess,
  saveSharingDataWindow,
  saveSharingPermission,
  updateProfessionalNote,
} from "@/server/repositories/professional-repository";
import { closeMediaForAction } from "@/server/services/realtime-session-service";

type Client = SupabaseClient<Database>;

export class ProfessionalAccessError extends Error {
  constructor(
    public readonly code:
      | "PROFESSIONAL_PROFILE_REQUIRED"
      | "PROFESSIONAL_CONNECTION_DENIED"
      | "PROFESSIONAL_REVIEWER_REQUIRED"
      | "PROFESSIONAL_INVITE_UNAVAILABLE",
    public readonly status = 403,
  ) {
    super(code);
    this.name = "ProfessionalAccessError";
  }
}

/**
 * Perfil com o estado **efetivo** de verificacao. `verified` vencido aparece
 * como `expired_review` ja aqui, do mesmo jeito que o banco decide na leitura -
 * a tela nunca mostra "verificado" para quem o banco ja nega.
 */
function withEffectiveStatus<
  T extends { verification_status: string; verification_review_due_at: string | null },
>(profile: T) {
  return {
    ...profile,
    effective_verification_status: effectiveVerificationStatus(
      profile.verification_status,
      profile.verification_review_due_at,
    ),
  };
}

export async function getProfessionalProfile(client: Client, user: User) {
  const profile = await findProfessionalProfile(client, user.id);
  return profile ? withEffectiveStatus(profile) : null;
}

export async function requireProfessionalProfile(client: Client, user: User) {
  const profile = await findProfessionalProfile(client, user.id);
  if (!profile) throw new ProfessionalAccessError("PROFESSIONAL_PROFILE_REQUIRED");
  return withEffectiveStatus(profile);
}

export async function updateProfessionalProfile(
  client: Client,
  rawInput: unknown,
) {
  const profile = await saveProfessionalProfile(
    client,
    professionalCredentialInputSchema.parse(rawInput),
  );
  return withEffectiveStatus(profile);
}

export async function getMyVerificationHistory(client: Client, user: User) {
  await requireProfessionalProfile(client, user);
  return listMyVerificationEvents(client);
}

/**
 * Fila de revisao. A barreira real e a RPC (reviewer ativo + `aal2`); esta
 * checagem so evita uma ida ao banco para quem obviamente nao e reviewer.
 */
async function requireReviewer(client: Client, user: User) {
  if (!(await findActiveReviewer(client, user.id))) {
    throw new ProfessionalAccessError("PROFESSIONAL_REVIEWER_REQUIRED");
  }
}

export async function getVerificationQueue(client: Client, user: User) {
  await requireReviewer(client, user);
  return listVerificationQueue(client);
}

export async function decideVerification(client: Client, user: User, rawInput: unknown) {
  await requireReviewer(client, user);
  const input = verificationReviewInputSchema.parse(rawInput);
  return { id: await reviewVerification(client, input) };
}

export async function getConnections(client: Client) {
  const [rows, names] = await Promise.all([
    listProfessionalConnections(client),
    // Nome do profissional so para as conexoes em que quem pergunta e o titular
    // (antes a tela mostrava o UUID). Falha no nome nao derruba a lista.
    listMyConnectionProfessionalNames(client).catch(() => new Map<string, string | null>()),
  ]);
  return (rows ?? []).map((row) => ({ ...row, professional_name: names.get(row.id) ?? null }));
}

export async function getProfessionalWorkspace(client: Client, user: User) {
  const found = await findProfessionalProfile(client, user.id);
  if (!found) return { profile: null, pending: [], patients: [] };
  const profile = withEffectiveStatus(found);

  const connections = await listProfessionalConnections(client);
  const pending = connections.filter(
    (connection) =>
      connection.professional_user_id === user.id &&
      connection.status === "pending",
  );
  const accepted = connections.filter(
    (connection) =>
      connection.professional_user_id === user.id &&
      connection.status === "active",
  );
  const patients = (
    await Promise.all(
      accepted.map(async (connection) => {
        const [connectedProfile, permissions] = await Promise.all([
          findConnectedProfile(client, connection.client_user_id),
          listSharingPermissions(client, connection.id),
        ]);
        if (!connectedProfile) return null;
        const now = Date.now();
        return {
          connection,
          profile: connectedProfile,
          activePermissionCount: permissions.filter((permission) =>
            grantIsCurrent(permission, now),
          ).length,
        };
      }),
    )
  ).filter((patient) => patient !== null);

  return { profile, pending, patients };
}

export async function changeConnection(
  client: Client,
  rawInput: unknown,
) {
  const input = professionalConnectionActionSchema.parse(rawInput);
  if (input.action === "pause") {
    const id = await pauseProfessionalRelationship(client, input.connectionId);
    await closeMediaForAction(client, { connectionId: input.connectionId });
    return { id };
  }
  if (input.action === "resume") {
    return { id: await resumeProfessionalRelationship(client, input.connectionId) };
  }
  if (input.action === "revoke") {
    // PRO-7R: chamada em curso cai ja (o banco ja recusa nova entrada).
    const id = await revokeProfessionalConnection(client, input.connectionId);
    await closeMediaForAction(client, { connectionId: input.connectionId });
    return { id };
  }
  return {
    id: await respondProfessionalInvitation(
      client,
      input.connectionId,
      input.action === "accept",
    ),
  };
}

export async function getPermissions(
  client: Client,
  connectionId: string,
) {
  const id = z.string().uuid().parse(connectionId);
  return listSharingPermissions(client, id);
}

export async function updatePermission(
  client: Client,
  rawInput: unknown,
) {
  const input = sharingPermissionInputSchema.parse(rawInput);
  const id = await saveSharingPermission(client, input);
  return { id };
}

/**
 * Define a janela de tempo do dado de uma permissao ja concedida.
 *
 * Caminho separado de `updatePermission` de proposito: conceder um dominio e
 * recortar o periodo dele sao decisoes distintas, e uma nao deve poder acontecer
 * como efeito colateral da outra. Quem revoga um escopo nao quer,
 * implicitamente, mexer na janela; quem estreita a janela nao quer revogar.
 *
 * A autorizacao real e do PostgreSQL: a RPC exige conexao aceita **do proprio
 * titular**. Este schema so recusa pedido malformado antes de chegar la.
 */
export async function updateDataWindow(
  client: Client,
  rawInput: unknown,
) {
  const input = sharingDataWindowInputSchema.parse(rawInput);
  const id = await saveSharingDataWindow(client, input);
  return { id };
}

/**
 * Vigencia do grant (inicio e fim). Autorizacao no banco: so o titular, numa
 * relationship ativa ou pausada, e so para grant concedido.
 */
export async function updateGrantValidity(client: Client, rawInput: unknown) {
  const input = sharingGrantValidityInputSchema.parse(rawInput);
  return { id: await saveSharingGrantValidity(client, input) };
}

export async function getNotes(
  client: Client,
  user: User,
  connectionId: string,
) {
  await requireProfessionalProfile(client, user);
  return listProfessionalNotes(client, z.string().uuid().parse(connectionId));
}

export async function createNote(client: Client, user: User, rawInput: unknown) {
  await requireProfessionalProfile(client, user);
  const input = professionalNoteInputSchema.parse(rawInput);
  return insertProfessionalNote(client, {
    ...input,
    professionalUserId: user.id,
  });
}

export async function editNote(client: Client, user: User, rawInput: unknown) {
  await requireProfessionalProfile(client, user);
  return updateProfessionalNote(client, professionalNoteUpdateSchema.parse(rawInput));
}

export async function removeNote(client: Client, user: User, id: string) {
  await requireProfessionalProfile(client, user);
  return deleteProfessionalNote(client, z.string().uuid().parse(id));
}

export async function getProfessionalPatient(
  client: Client,
  user: User,
  rawClientUserId: string,
) {
  await requireProfessionalProfile(client, user);
  const clientUserId = z.string().uuid().parse(rawClientUserId);
  const connection = await findAcceptedProfessionalConnection(
    client,
    user.id,
    clientUserId,
  );
  if (!connection) {
    throw new ProfessionalAccessError("PROFESSIONAL_CONNECTION_DENIED");
  }
  const [profile, permissions, data, sessions, notes] = await Promise.all([
    findConnectedProfile(client, clientUserId),
    listSharingPermissions(client, connection.id),
    readProfessionalPatientData(client, clientUserId),
    readProfessionalSessionData(client, clientUserId),
    listProfessionalNotes(client, connection.id),
  ]);
  if (!profile) throw new ProfessionalAccessError("PROFESSIONAL_CONNECTION_DENIED");
  const now = Date.now();
  const currentPermissions = permissions.filter((permission) =>
    grantIsCurrent(permission, now),
  );
  /*
   * A trilha e escrita **depois** de a leitura ter sido autorizada, e nunca
   * derruba a leitura.
   *
   * Registrar antes afirmaria um acesso que a RLS ainda podia recusar; deixar a
   * falha do log abortar a consulta transformaria um problema de auditoria em
   * indisponibilidade de atendimento. O erro e propagado ao observability como
   * qualquer outro, sem `details` do Postgres - a licao de `L-068` e que
   * best-effort silencioso e onde defeito mora dois meses sem ninguem ver.
   */
  try {
    await appendProfessionalAccess(client, {
      connectionId: connection.id,
      clientUserId,
      professionalUserId: user.id,
      scopes: currentPermissions.map((permission) => permission.scope),
    });
  } catch (caught) {
    console.error("elyra.professional_access_log_failed", {
      connection_id: connection.id,
      reason: caught instanceof Error ? caught.message : "unknown",
    });
  }

  return {
    readAt: now,
    connection,
    profile,
    permissions: currentPermissions,
    data,
    sessions,
    notes,
  };
}

/**
 * A trilha de acesso, do ponto de vista de quem e dona do dado.
 *
 * Nao recebe `userId`: a RLS ja devolve somente as linhas do titular, e passar o
 * id abriria a porta para alguem passar o id de outra pessoa. A licao de `L-058`
 * e exatamente essa - `\.eq("user_id")` como ownership generico e o que produz
 * vazamento silencioso.
 */
export async function getMyProfessionalAccessLog(client: Client) {
  return listProfessionalAccess(client, 100);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * Cria um convite e devolve o token **uma unica vez**. Quem autoriza e o banco
 * (profissional com verificacao vigente, ate 20 convites vivos); aqui so se
 * exige ter perfil, para a mensagem de erro fazer sentido.
 */
export async function createInvite(client: Client, user: User) {
  await requireProfessionalProfile(client, user);
  const created = await createProfessionalInvite(client);
  return {
    inviteId: created.invite_id,
    token: created.token,
    expiresAt: created.expires_at,
  };
}

export async function getMyInvites(client: Client, user: User) {
  await requireProfessionalProfile(client, user);
  return listMyProfessionalInvites(client);
}

export async function revokeInvite(client: Client, user: User, rawId: string) {
  await requireProfessionalProfile(client, user);
  return { id: await revokeProfessionalInvite(client, z.string().uuid().parse(rawId)) };
}

/**
 * Resgate pela pessoa convidada: abrir, aceitar ou recusar.
 *
 * Toda falha de token vira o **mesmo** erro, sem dizer se o convite nao
 * existe, expirou, foi revogado ou ja foi usado. Aceitar cria/reativa a
 * relationship e nao concede dado nenhum: os grants continuam sendo decisao
 * separada do titular.
 */
export async function redeemInvite(client: Client, rawInput: unknown) {
  const input = inviteRedeemInputSchema.parse(rawInput);
  if (input.action === "preview") {
    const preview = await previewProfessionalInvite(client, input.token);
    if (!preview) throw new ProfessionalAccessError("PROFESSIONAL_INVITE_UNAVAILABLE", 404);
    return {
      action: "preview" as const,
      professional: {
        displayName: preview.professional_display_name,
        council: preview.council,
        councilRegion: preview.council_region,
        registrationNumber: preview.registration_number,
        specialty: preview.specialty,
      },
      expiresAt: preview.expires_at,
    };
  }
  if (input.action === "accept") {
    const accepted = await acceptProfessionalInvite(client, input.token);
    if (!accepted) throw new ProfessionalAccessError("PROFESSIONAL_INVITE_UNAVAILABLE", 404);
    return {
      action: "accept" as const,
      relationshipId: accepted.connection_id,
      outcome: accepted.outcome as InviteAcceptOutcome,
      status: accepted.connection_status,
      professional: {
        displayName: accepted.professional_display_name,
        slug: accepted.professional_slug ?? null,
      },
    };
  }
  const declined = await declineProfessionalInvite(client, input.token);
  if (!declined) throw new ProfessionalAccessError("PROFESSIONAL_INVITE_UNAVAILABLE", 404);
  return { action: "decline" as const };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/**
 * Tudo que o portal precisa, em no maximo 5 consultas independentes do numero
 * de pessoas acompanhadas (vinculos, nomes, grants, convites, perfil) - sem
 * N+1 e sem conteudo de titular.
 *
 * Cada fonte falha sozinha: o cockpit mostra erro no bloco afetado e continua
 * mostrando o resto. `null` em uma fonte significa "indisponivel", nunca
 * "vazio".
 */
export async function getProfessionalPortal(client: Client, user: User) {
  const profileResult = await findProfessionalProfile(client, user.id).then(
    (value) => ({ ok: true as const, value }),
    () => ({ ok: false as const, value: null }),
  );
  const profile = profileResult.value ? withEffectiveStatus(profileResult.value) : null;
  if (profileResult.ok && !profile) {
    return {
      now: Date.now(),
      profile: null,
      profileAvailable: true,
      relationships: [] as PortalRelationship[],
      relationshipsAvailable: true,
      invites: [] as PortalInvite[],
      invitesAvailable: true,
    };
  }

  const [relationshipResult, inviteResult] = await Promise.allSettled([
    (async () => {
      const rows = await listRelationshipsAsProfessional(client, user.id);
      const [names, grants] = await Promise.all([
        listVisibleClientNames(
          client,
          rows.map((row) => row.client_user_id),
        ),
        listGrantsForRelationships(
          client,
          rows.map((row) => row.id),
        ),
      ]);
      return rows.map<PortalRelationship>((row) => ({
        id: row.id,
        clientUserId: row.client_user_id,
        displayName: names.get(row.client_user_id) ?? null,
        status: row.status as PortalRelationship["status"],
        invitedAt: row.invited_at,
        acceptedAt: row.accepted_at,
        pausedAt: row.paused_at,
        endedAt: row.ended_at,
        revokedAt: row.revoked_at,
        updatedAt: row.updated_at,
        fromInvite: row.invited_by_user_id === user.id || row.origin_invite_id !== null,
        grants: grants
          .filter((grant) => grant.connection_id === row.id)
          .map((grant) => ({
            id: grant.id,
            scope: grant.scope as PortalGrant["scope"],
            journalEntryId: grant.journal_entry_id,
            status: grant.status as PortalGrant["status"],
            permission: grant.permission,
            grantedAt: grant.granted_at,
            validFrom: grant.valid_from,
            validUntil: grant.expires_at,
            dataFrom: grant.data_from,
            dataTo: grant.data_to,
            revokedAt: grant.revoked_at,
          })),
      }));
    })(),
    listMyProfessionalInvites(client).then((rows) =>
      rows.map<PortalInvite>((row) => ({
        id: row.id,
        state: row.state as PortalInvite["state"],
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        openedAt: row.opened_at,
        acceptedAt: row.accepted_at,
        consumedAt: row.consumed_at,
        revokedAt: row.revoked_at,
        relationshipId: row.relationship_id,
      })),
    ),
  ]);

  for (const result of [relationshipResult, inviteResult]) {
    if (result.status === "rejected") {
      console.error("elyra.professional_portal_block_failed", {
        reason: result.reason instanceof Error ? result.reason.message : "unknown",
      });
    }
  }

  return {
    /** Instante unico da leitura: cockpit, listas e navegador classificam igual. */
    now: Date.now(),
    profile,
    profileAvailable: profileResult.ok,
    relationships: relationshipResult.status === "fulfilled" ? relationshipResult.value : [],
    relationshipsAvailable: relationshipResult.status === "fulfilled",
    invites: inviteResult.status === "fulfilled" ? inviteResult.value : [],
    invitesAvailable: inviteResult.status === "fulfilled",
  };
}

export type ProfessionalPortal = Awaited<ReturnType<typeof getProfessionalPortal>>;

export function portalVerification(portal: ProfessionalPortal): PortalVerification | null {
  if (!portal.profile) return null;
  return {
    status: portal.profile.effective_verification_status,
    reviewDueAt: portal.profile.verification_review_due_at,
    councilRegion: portal.profile.council_region,
    registrationNumber: portal.profile.registration_number,
  };
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------

/** Janelas iguais as do snapshot (28/56/90): a mesma regra, os mesmos cortes. */
export const PROFESSIONAL_REPORT_DAYS = [28, 56, 90] as const;
export type ProfessionalReportDays = (typeof PROFESSIONAL_REPORT_DAYS)[number];

/** Fuso das datas civis do relatorio. A Elyra opera em pt-BR; declarado na tela. */
export const PROFESSIONAL_REPORT_TIME_ZONE = "America/Sao_Paulo";

const reportQuerySchema = z.object({
  clientUserId: z.string().uuid().optional(),
  days: z.coerce
    .number()
    .refine((value): value is ProfessionalReportDays =>
      (PROFESSIONAL_REPORT_DAYS as readonly number[]).includes(value),
    )
    .catch(28),
  snapshotId: z.string().uuid().optional(),
});

function civilToday(timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * Relatorio de evolucao de UMA pessoa, calculado pela mesma regra deterministica
 * do relatorio do titular (`buildAnalyticsReport`), sobre o que a RLS devolve.
 *
 * Tres camadas separadas, sempre: o que a pessoa registrou (contagem de dias),
 * o calculo Elyra (medias e comparacao) e, so com escopo proprio, a existencia
 * de leituras de IA - nunca o texto delas aqui, nunca como verdade clinica.
 */
export async function getProfessionalReports(
  client: Client,
  user: User,
  rawQuery: { pessoa?: string; periodo?: string; snapshot?: string },
) {
  const profile = await requireProfessionalProfile(client, user);
  const query = reportQuerySchema.safeParse({
    clientUserId: rawQuery.pessoa || undefined,
    days: rawQuery.periodo,
    snapshotId: rawQuery.snapshot || undefined,
  });
  const days: ProfessionalReportDays = query.success ? query.data.days : 28;
  const relationships = await listRelationshipsAsProfessional(client, user.id);
  const active = relationships.filter((relationship) => relationship.status === "active");
  const names = await listVisibleClientNames(
    client,
    active.map((relationship) => relationship.client_user_id),
  );
  const people = active
    .map((relationship) => ({
      clientUserId: relationship.client_user_id,
      displayName: names.get(relationship.client_user_id) ?? null,
    }))
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? "", "pt-BR"));

  const base = {
    verified: profile.effective_verification_status === "verified",
    people,
    days,
    timeZone: PROFESSIONAL_REPORT_TIME_ZONE,
  };
  if (!query.success || !query.data.clientUserId) {
    return { ...base, invalidQuery: !query.success, selected: null, denied: false };
  }

  const clientUserId = query.data.clientUserId;
  const connection = await findAcceptedProfessionalConnection(client, user.id, clientUserId);
  if (!connection) return { ...base, invalidQuery: false, selected: null, denied: true };

  const now = Date.now();
  const grants = (await listSharingPermissions(client, connection.id)).filter((grant) =>
    grantIsCurrent(grant, now),
  );
  const scopes = new Set(grants.map((grant) => grant.scope));
  const reference = civilToday(PROFESSIONAL_REPORT_TIME_ZONE);
  const since = new Date(now - (2 * days + 2) * 86_400_000);
  const sinceIso = since.toISOString();
  const sinceDate = sinceIso.slice(0, 10);

  const [emotional, sleep, snapshots, interpretations, snapshot] = await Promise.all([
    scopes.has("emotional") ? readEmotionalSeries(client, clientUserId, sinceIso) : Promise.resolve(null),
    scopes.has("sleep") ? readSleepSeries(client, clientUserId, sinceDate) : Promise.resolve(null),
    scopes.has("reports") ? listReportSnapshotMeta(client, clientUserId) : Promise.resolve(null),
    scopes.has("multimodal_ai_interpretation")
      ? listInterpretationMeta(client, clientUserId, sinceIso)
      : Promise.resolve(null),
    scopes.has("reports") && query.data.snapshotId
      ? findReportSnapshot(client, clientUserId, query.data.snapshotId)
      : Promise.resolve(null),
  ]);

  const report =
    emotional || sleep
      ? buildAnalyticsReport({
          referenceDate: reference,
          days,
          timeZone: PROFESSIONAL_REPORT_TIME_ZONE,
          checkins: (emotional ?? []).map((row, index) => ({
            id: String(index),
            occurredAt: row.occurred_at,
            mood: row.mood_score,
            perceivedAnxiety: row.perceived_anxiety_score,
            energy: row.energy_score,
            primaryFeeling: null,
            factorIds: [],
            note: null,
          })),
          sleep: (sleep ?? []).map((row, index) => ({
            id: String(index),
            night: row.night,
            durationMinutes: row.duration_minutes,
            quality: row.sleep_quality_score,
          })),
          periods: [],
          cycleEnabled: false,
        })
      : null;

  const read = [
    ...(emotional ? (["emotional"] as const) : []),
    ...(sleep ? (["sleep"] as const) : []),
    ...(snapshots ? (["reports"] as const) : []),
  ];
  try {
    await appendProfessionalAccess(client, {
      connectionId: connection.id,
      clientUserId,
      professionalUserId: user.id,
      scopes: [...read],
    });
  } catch (caught) {
    console.error("elyra.professional_access_log_failed", {
      connection_id: connection.id,
      reason: caught instanceof Error ? caught.message : "unknown",
    });
  }

  return {
    ...base,
    invalidQuery: false,
    denied: false,
    selected: {
      clientUserId,
      displayName: names.get(clientUserId) ?? null,
      scopes: [...scopes],
      emotionalShared: scopes.has("emotional"),
      sleepShared: scopes.has("sleep"),
      reportsShared: scopes.has("reports"),
      aiShared: scopes.has("multimodal_ai_interpretation"),
      report,
      snapshots,
      snapshot,
      interpretations,
    },
  };
}

export type ProfessionalReports = Awaited<ReturnType<typeof getProfessionalReports>>;

const connectionRequestSchema = z
  .object({ slug: z.string().regex(/^[0-9a-f]{16}$/, "Perfil inválido.") })
  .strict();

/** Fluxo B — "Solicitar acompanhamento" no perfil público. */
export async function requestAccompaniment(client: Client, rawInput: unknown) {
  const { slug } = connectionRequestSchema.parse(rawInput);
  return requestProfessionalConnection(client, slug);
}

export async function getMyConnectionForDirectorySlug(client: Client, slug: string) {
  return findMyConnectionForDirectorySlug(client, slug);
}

export async function getMyConnectionProfessionalNames(client: Client) {
  return Object.fromEntries(await listMyConnectionProfessionalNames(client));
}
