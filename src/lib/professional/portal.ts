

import { grantIsCurrent, type RelationshipStatus, type SharingScope } from "@/lib/contracts/sharing";
import type { InviteState } from "@/lib/contracts/professional-invites";
import type { VerificationStatus } from "@/lib/contracts/professional-verification";

export interface PortalGrant {
  id: string;
  scope: SharingScope;
  journalEntryId: string | null;
  status: "granted" | "revoked";
  permission: string;
  grantedAt: string;
  validFrom: string | null;
  validUntil: string | null;
  dataFrom: string | null;
  dataTo: string | null;
  revokedAt: string | null;
}

export interface PortalRelationship {
  id: string;
  clientUserId: string;
  /** `null` quando a RLS nao devolve o nome (vinculo nao ativo). */
  displayName: string | null;
  status: RelationshipStatus;
  invitedAt: string;
  acceptedAt: string | null;
  pausedAt: string | null;
  endedAt: string | null;
  revokedAt: string | null;
  updatedAt: string;
  /** Vinculo nascido de convite do profissional (PRO-2), e nao de pedido legado. */
  fromInvite: boolean;
  grants: PortalGrant[];
}

export interface PortalInvite {
  id: string;
  state: InviteState;
  createdAt: string;
  expiresAt: string;
  openedAt: string | null;
  acceptedAt: string | null;
  consumedAt: string | null;
  revokedAt: string | null;
  relationshipId: string | null;
}

export interface PortalVerification {
  status: VerificationStatus;
  reviewDueAt: string | null;
  councilRegion: string | null;
  registrationNumber: string;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export function currentGrants(relationship: PortalRelationship, now: number = Date.now()) {
  return relationship.grants.filter((grant) =>
    grantIsCurrent(
      {
        status: grant.status,
        revoked_at: grant.revokedAt,
        expires_at: grant.validUntil,
        valid_from: grant.validFrom,
      },
      now,
    ),
  );
}

export function isLiveInvite(invite: PortalInvite) {
  return invite.state === "created" || invite.state === "opened";
}

/** Quantos escopos distintos estao vigentes (diario por entrada conta uma vez). */
export function currentScopeCount(relationship: PortalRelationship, now: number = Date.now()) {
  return new Set(currentGrants(relationship, now).map((grant) => grant.scope)).size;
}

/** Instante mais recente de mudanca que o profissional conhece. */
export function lastKnownChange(relationship: PortalRelationship) {
  const stamps = [
    relationship.updatedAt,
    relationship.acceptedAt,
    relationship.pausedAt,
    relationship.endedAt,
    relationship.revokedAt,
    ...relationship.grants.flatMap((grant) => [grant.grantedAt, grant.revokedAt]),
  ].filter((value): value is string => Boolean(value));
  return stamps.reduce((latest, value) => (value > latest ? value : latest), relationship.invitedAt);
}

// ---------------------------------------------------------------------------
// Cockpit
// ---------------------------------------------------------------------------

export type AttentionKind =
  | "verification"
  | "pending_request"
  | "invite_expiring"
  | "grant_ending"
  | "first_invite";

export interface AttentionItem {
  kind: AttentionKind;
  key: string;
  title: string;
  detail: string;
  href: "/pro/perfil" | "/pro/solicitacoes" | "/pro/vinculos";
  actionLabel: string;
  /** Ordena: menor primeiro. */
  priority: number;
  at: string | null;
}

export type ActivityKind =
  | "relationship_active"
  | "relationship_paused"
  | "relationship_ended"
  | "relationship_revoked"
  | "grant_received"
  | "grant_revoked"
  | "invite_accepted"
  | "invite_declined"
  | "invite_created";

export interface ActivityItem {
  kind: ActivityKind;
  key: string;
  at: string;
  title: string;
  detail: string;
}

export interface Cockpit {
  counts: {
    active: number;
    paused: number;
    liveInvites: number;
    pendingRequests: number;
  };
  attention: AttentionItem[];
  attentionTotal: number;
  recent: PortalRelationship[];
  activity: ActivityItem[];
}

export const COCKPIT_LIMITS = { attention: 5, recent: 5, activity: 10 } as const;

function personLabel(relationship: PortalRelationship) {
  return relationship.displayName ?? "Pessoa acompanhada";
}

export function buildAttention(input: {
  verification: PortalVerification | null;
  relationships: PortalRelationship[];
  invites: PortalInvite[];
  scopeLabel: (scope: SharingScope) => string;
  now?: number;
}): AttentionItem[] {
  const now = input.now ?? Date.now();
  const items: AttentionItem[] = [];
  const verification = input.verification;

  if (verification && verification.status !== "verified") {
    items.push({
      kind: "verification",
      key: "verification",
      title: "Registro sem verificação vigente",
      detail:
        "Enquanto isso, você não acessa dados compartilhados nem gera convites.",
      href: "/pro/perfil",
      actionLabel: "Ver verificação",
      priority: 0,
      at: null,
    });
  } else if (verification?.reviewDueAt) {
    const left = Date.parse(verification.reviewDueAt) - now;
    if (left <= 30 * DAY) {
      items.push({
        kind: "verification",
        key: "verification-due",
        title: "Verificação perto do fim da validade",
        detail: `Válida até ${formatDate(verification.reviewDueAt)}. Depois disso o acesso é suspenso até nova conferência.`,
        href: "/pro/perfil",
        actionLabel: "Ver verificação",
        priority: 1,
        at: verification.reviewDueAt,
      });
    }
  }

  for (const relationship of input.relationships) {
    if (relationship.status === "pending" && !relationship.fromInvite) {
      items.push({
        kind: "pending_request",
        key: `request-${relationship.id}`,
        title: "Solicitação de acompanhamento aguardando resposta",
        detail: `Recebido em ${formatDate(relationship.invitedAt)}.`,
        href: "/pro/solicitacoes",
        actionLabel: "Responder",
        priority: 2,
        at: relationship.invitedAt,
      });
    }
  }

  for (const invite of input.invites) {
    if (!isLiveInvite(invite)) continue;
    const left = Date.parse(invite.expiresAt) - now;
    if (left > 0 && left <= 24 * HOUR) {
      items.push({
        kind: "invite_expiring",
        key: `invite-${invite.id}`,
        title: "Convite expira em menos de 24 horas",
        detail: `Criado em ${formatDate(invite.createdAt)}. Se ainda for útil, revogue e gere outro.`,
        href: "/pro/solicitacoes",
        actionLabel: "Ver convites",
        priority: 3,
        at: invite.expiresAt,
      });
    }
  }

  for (const relationship of input.relationships) {
    if (relationship.status !== "active") continue;
    for (const grant of currentGrants(relationship, now)) {
      if (!grant.validUntil) continue;
      const left = Date.parse(grant.validUntil) - now;
      if (left > 0 && left <= 7 * DAY) {
        items.push({
          kind: "grant_ending",
          key: `grant-${grant.id}`,
          title: `Acesso a ${input.scopeLabel(grant.scope)} termina em breve`,
          detail: `${personLabel(relationship)} · até ${formatDate(grant.validUntil)}.`,
          href: "/pro/vinculos",
          actionLabel: "Ver acessos",
          priority: 4,
          at: grant.validUntil,
        });
      }
    }
  }

  if (
    verification?.status === "verified" &&
    input.relationships.length === 0 &&
    !input.invites.some(isLiveInvite)
  ) {
    items.push({
      kind: "first_invite",
      key: "first-invite",
      title: "Nenhum acompanhamento ainda",
      detail: "Gere um código de convite e entregue à pessoa. Aceitar cria o vínculo sem compartilhar nada.",
      href: "/pro/solicitacoes",
      actionLabel: "Gerar convite",
      priority: 5,
      at: null,
    });
  }

  return items.sort(
    (a, b) => a.priority - b.priority || (a.at ?? "").localeCompare(b.at ?? ""),
  );
}

export function buildActivity(input: {
  relationships: PortalRelationship[];
  invites: PortalInvite[];
  scopeLabel: (scope: SharingScope) => string;
}): ActivityItem[] {
  const items: ActivityItem[] = [];
  for (const relationship of input.relationships) {
    const who = personLabel(relationship);
    if (relationship.acceptedAt) {
      items.push({
        kind: "relationship_active",
        key: `active-${relationship.id}`,
        at: relationship.acceptedAt,
        title: "Vínculo ativo",
        detail: who,
      });
    }
    if (relationship.pausedAt) {
      items.push({
        kind: "relationship_paused",
        key: `paused-${relationship.id}`,
        at: relationship.pausedAt,
        title: "Vínculo pausado pela pessoa",
        detail: who,
      });
    }
    if (relationship.revokedAt) {
      items.push({
        kind: "relationship_revoked",
        key: `revoked-${relationship.id}`,
        at: relationship.revokedAt,
        title: "Vínculo encerrado pela pessoa",
        detail: who,
      });
    }
    if (relationship.endedAt) {
      items.push({
        kind: "relationship_ended",
        key: `ended-${relationship.id}`,
        at: relationship.endedAt,
        title: "Vínculo encerrado por você",
        detail: who,
      });
    }
    /*
      Grants concedidos no mesmo minuto viram um evento so: quem marca seis
      escopos de uma vez tomou uma decisao, e nao seis. Listar seis linhas iguais
      empurraria para fora da tela o que de fato mudou.
    */
    const grantedBatches = new Map<string, PortalGrant[]>();
    for (const grant of relationship.grants) {
      const minute = grant.grantedAt.slice(0, 16);
      grantedBatches.set(minute, [...(grantedBatches.get(minute) ?? []), grant]);
    }
    for (const [minute, batch] of grantedBatches) {
      const labels = [...new Set(batch.map((grant) => input.scopeLabel(grant.scope)))];
      items.push({
        kind: "grant_received",
        key: `grant-${relationship.id}-${minute}`,
        at: batch[0]!.grantedAt,
        title:
          labels.length === 1
            ? `Acesso concedido: ${labels[0]}`
            : `Acesso concedido a ${labels.length} escopos`,
        detail: labels.length === 1 ? who : `${who} · ${labels.slice(0, 3).join(", ")}${labels.length > 3 ? "…" : ""}`,
      });
    }
    for (const grant of relationship.grants) {
      if (grant.revokedAt) {
        items.push({
          kind: "grant_revoked",
          key: `grant-revoked-${grant.id}-${grant.revokedAt}`,
          at: grant.revokedAt,
          title: `Acesso revogado: ${input.scopeLabel(grant.scope)}`,
          detail: who,
        });
      }
    }
  }
  for (const invite of input.invites) {
    items.push({
      kind: "invite_created",
      key: `invite-${invite.id}`,
      at: invite.createdAt,
      title: "Convite gerado",
      detail: `Válido até ${formatDate(invite.expiresAt)}`,
    });
    if (invite.state === "accepted" && invite.acceptedAt) {
      items.push({
        kind: "invite_accepted",
        key: `invite-accepted-${invite.id}`,
        at: invite.acceptedAt,
        title: "Convite aceito",
        detail: "O vínculo foi criado sem nenhum compartilhamento.",
      });
    }
    if (invite.state === "consumed" && invite.consumedAt) {
      items.push({
        kind: "invite_declined",
        key: `invite-declined-${invite.id}`,
        at: invite.consumedAt,
        title: "Convite recusado",
        detail: "O código não pode mais ser usado.",
      });
    }
  }
  return items.sort((a, b) => b.at.localeCompare(a.at));
}

export function buildCockpit(input: {
  verification: PortalVerification | null;
  relationships: PortalRelationship[];
  invites: PortalInvite[];
  scopeLabel: (scope: SharingScope) => string;
  now?: number;
}): Cockpit {
  const now = input.now ?? Date.now();
  const attention = buildAttention({ ...input, now });
  const recent = input.relationships
    .filter((relationship) => relationship.status === "active" || relationship.status === "paused")
    // Ativos primeiro: sao os que abrem dossie. Pausados (sem nome por RLS)
    // entram depois, se sobrar lugar, em vez de abrir a lista com linhas
    // iguais de "Pessoa acompanhada".
    .sort(
      (a, b) =>
        Number(b.status === "active") - Number(a.status === "active") ||
        lastKnownChange(b).localeCompare(lastKnownChange(a)),
    )
    .slice(0, COCKPIT_LIMITS.recent);

  return {
    counts: {
      active: input.relationships.filter((r) => r.status === "active").length,
      paused: input.relationships.filter((r) => r.status === "paused").length,
      liveInvites: input.invites.filter(isLiveInvite).length,
      pendingRequests: input.relationships.filter(
        (r) => r.status === "pending" && !r.fromInvite,
      ).length,
    },
    attention: attention.slice(0, COCKPIT_LIMITS.attention),
    attentionTotal: attention.length,
    recent,
    /*
      A atividade mora na coluna lateral. O tamanho dela acompanha o conteudo da
      coluna principal (pendencias + recentes), para as duas terminarem perto
      uma da outra sem esticar card nem inventar linha - regra de zero espaco
      morto do PRO-4, derivada do dado e nao de altura fixa.
    */
    activity: buildActivity(input).slice(
      0,
      Math.min(
        COCKPIT_LIMITS.activity,
        Math.max(3, Math.min(attention.length, COCKPIT_LIMITS.attention) + recent.length + 2),
      ),
    ),
  };
}

// ---------------------------------------------------------------------------
// Acompanhamentos: filtro, busca e ordenacao
// ---------------------------------------------------------------------------

export type RelationshipFilter = "all" | "active" | "paused" | "pending" | "closed";
export type RelationshipSort = "recent" | "name" | "since";

export const RELATIONSHIP_FILTERS: Array<{ value: RelationshipFilter; label: string }> = [
  { value: "all", label: "Todos" },
  { value: "active", label: "Ativos" },
  { value: "paused", label: "Pausados" },
  { value: "pending", label: "Pendentes" },
  { value: "closed", label: "Encerrados" },
];

export function matchesFilter(relationship: PortalRelationship, filter: RelationshipFilter) {
  if (filter === "all") return true;
  if (filter === "closed") return relationship.status === "revoked" || relationship.status === "ended";
  return relationship.status === filter;
}

export function normalizeSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

export function filterRelationships(
  relationships: PortalRelationship[],
  options: { filter: RelationshipFilter; query: string; sort: RelationshipSort },
) {
  const query = normalizeSearch(options.query);
  const filtered = relationships.filter(
    (relationship) =>
      matchesFilter(relationship, options.filter) &&
      (query === "" ||
        (relationship.displayName !== null &&
          normalizeSearch(relationship.displayName).includes(query))),
  );
  const byName = (a: PortalRelationship, b: PortalRelationship) =>
    (a.displayName ?? "￿").localeCompare(b.displayName ?? "￿", "pt-BR");
  return filtered.sort((a, b) => {
    if (options.sort === "name") return byName(a, b);
    if (options.sort === "since") {
      return (b.acceptedAt ?? b.invitedAt).localeCompare(a.acceptedAt ?? a.invitedAt);
    }
    return lastKnownChange(b).localeCompare(lastKnownChange(a));
  });
}

export function formatDate(iso: string) {
  const value = iso.length === 10 ? `${iso}T12:00:00Z` : iso;
  return new Date(value).toLocaleDateString("pt-BR");
}

export function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
