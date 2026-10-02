import { describe, expect, it } from "vitest";

import {
  buildCockpit,
  COCKPIT_LIMITS,
  currentScopeCount,
  filterRelationships,
  type PortalGrant,
  type PortalInvite,
  type PortalRelationship,
  type PortalVerification,
} from "./portal";

const NOW = Date.parse("2026-09-24T12:00:00Z");
const label = (scope: string) => scope;

const verified: PortalVerification = {
  status: "verified",
  reviewDueAt: "2027-09-24T12:00:00Z",
  councilRegion: "06",
  registrationNumber: "06/1",
};

function grant(overrides: Partial<PortalGrant> = {}): PortalGrant {
  return {
    id: crypto.randomUUID(),
    scope: "emotional",
    journalEntryId: null,
    status: "granted",
    permission: "read",
    grantedAt: "2026-09-20T10:00:00Z",
    validFrom: null,
    validUntil: null,
    dataFrom: null,
    dataTo: null,
    revokedAt: null,
    ...overrides,
  };
}

function relationship(overrides: Partial<PortalRelationship> = {}): PortalRelationship {
  return {
    id: crypto.randomUUID(),
    clientUserId: crypto.randomUUID(),
    displayName: "Ana",
    status: "active",
    invitedAt: "2026-09-10T10:00:00Z",
    acceptedAt: "2026-09-10T11:00:00Z",
    pausedAt: null,
    endedAt: null,
    revokedAt: null,
    updatedAt: "2026-09-10T11:00:00Z",
    fromInvite: true,
    grants: [],
    ...overrides,
  };
}

function invite(overrides: Partial<PortalInvite> = {}): PortalInvite {
  return {
    id: crypto.randomUUID(),
    state: "created",
    createdAt: "2026-09-23T13:00:00Z",
    expiresAt: "2026-09-26T13:00:00Z",
    openedAt: null,
    acceptedAt: null,
    consumedAt: null,
    revokedAt: null,
    relationshipId: null,
    ...overrides,
  };
}

describe("cockpit profissional", () => {
  it("0 acompanhamentos: pede o primeiro convite, sem inventar numero", () => {
    const cockpit = buildCockpit({ verification: verified, relationships: [], invites: [], scopeLabel: label, now: NOW });
    expect(cockpit.counts).toEqual({ active: 0, paused: 0, liveInvites: 0, pendingRequests: 0 });
    expect(cockpit.attention.map((item) => item.kind)).toEqual(["first_invite"]);
    expect(cockpit.recent).toEqual([]);
    expect(cockpit.activity).toEqual([]);
  });

  it("verificacao nao vigente vem antes de tudo e suprime o convite inicial", () => {
    const cockpit = buildCockpit({
      verification: { ...verified, status: "expired_review", reviewDueAt: null },
      relationships: [],
      invites: [],
      scopeLabel: label,
      now: NOW,
    });
    expect(cockpit.attention[0]?.kind).toBe("verification");
    expect(cockpit.attention.some((item) => item.kind === "first_invite")).toBe(false);
  });

  it("verificacao vencendo em 30 dias vira pendencia", () => {
    const cockpit = buildCockpit({
      verification: { ...verified, reviewDueAt: "2026-10-10T12:00:00Z" },
      relationships: [relationship()],
      invites: [],
      scopeLabel: label,
      now: NOW,
    });
    expect(cockpit.attention[0]?.key).toBe("verification-due");
  });

  it("pedido legado, convite a expirar e grant terminando sao pendencias reais", () => {
    const cockpit = buildCockpit({
      verification: verified,
      relationships: [
        relationship({ status: "pending", acceptedAt: null, fromInvite: false, displayName: null }),
        relationship({ grants: [grant({ validUntil: "2026-09-27T12:00:00Z" })] }),
      ],
      invites: [invite({ expiresAt: "2026-09-24T20:00:00Z" })],
      scopeLabel: label,
      now: NOW,
    });
    expect(cockpit.attention.map((item) => item.kind)).toEqual([
      "pending_request",
      "invite_expiring",
      "grant_ending",
    ]);
    expect(cockpit.counts.pendingRequests).toBe(1);
  });

  it("10+ acompanhamentos: listas truncadas, contagem completa", () => {
    const many = Array.from({ length: 14 }, (_, index) =>
      relationship({
        displayName: `Pessoa ${index}`,
        updatedAt: `2026-09-${String(10 + (index % 10)).padStart(2, "0")}T10:00:00Z`,
        grants: [grant({ validUntil: "2026-09-26T12:00:00Z" })],
      }),
    );
    const cockpit = buildCockpit({ verification: verified, relationships: many, invites: [], scopeLabel: label, now: NOW });
    expect(cockpit.counts.active).toBe(14);
    expect(cockpit.recent).toHaveLength(COCKPIT_LIMITS.recent);
    expect(cockpit.attention).toHaveLength(COCKPIT_LIMITS.attention);
    expect(cockpit.attentionTotal).toBe(14);
    expect(cockpit.activity.length).toBeLessThanOrEqual(COCKPIT_LIMITS.activity);
  });

  it("recentes: ativos antes de pausados; atividade acompanha a coluna principal ate o teto", () => {
    const people = [
      ...Array.from({ length: 2 }, (_, index) =>
        relationship({
          status: "paused",
          displayName: null,
          pausedAt: `2026-09-23T1${index}:00:00Z`,
          updatedAt: `2026-09-23T1${index}:00:00Z`,
        }),
      ),
      ...Array.from({ length: 7 }, (_, index) =>
        relationship({
          displayName: `Ativa ${index}`,
          updatedAt: `2026-09-1${index}T10:00:00Z`,
          grants: [grant({ grantedAt: `2026-09-1${index}T10:00:00Z` }), grant({ scope: "sleep", grantedAt: `2026-09-1${index}T11:00:00Z` })],
        }),
      ),
    ];
    const cockpit = buildCockpit({ verification: verified, relationships: people, invites: [], scopeLabel: label, now: NOW });
    expect(cockpit.recent.map((r) => r.status)).toEqual(["active", "active", "active", "active", "active"]);
    expect(cockpit.recent[0]?.displayName).toBe("Ativa 6");
    // 0 pendencias + 5 recentes + 2 = 7 itens de atividade (ha mais eventos que isso).
    expect(cockpit.activity).toHaveLength(7);
    expect(COCKPIT_LIMITS.activity).toBe(10);
  });

  it("encerrados nao entram em recentes; pausados sim", () => {
    const cockpit = buildCockpit({
      verification: verified,
      relationships: [
        relationship({ status: "paused", pausedAt: "2026-09-22T10:00:00Z", displayName: null }),
        relationship({ status: "ended", endedAt: "2026-09-21T10:00:00Z" }),
      ],
      invites: [],
      scopeLabel: label,
      now: NOW,
    });
    expect(cockpit.recent.map((r) => r.status)).toEqual(["paused"]);
    expect(cockpit.counts.paused).toBe(1);
  });

  it("atividade vem so de metadados que o profissional ja le, mais recente primeiro", () => {
    const cockpit = buildCockpit({
      verification: verified,
      relationships: [
        relationship({
          pausedAt: "2026-09-23T10:00:00Z",
          status: "paused",
          grants: [grant({ grantedAt: "2026-09-22T10:00:00Z" })],
        }),
      ],
      invites: [
        invite({
          state: "accepted",
          createdAt: "2026-09-20T09:00:00Z",
          acceptedAt: "2026-09-21T10:00:00Z",
          consumedAt: "2026-09-21T10:00:00Z",
        }),
      ],
      scopeLabel: label,
      now: NOW,
    });
    const kinds = cockpit.activity.map((item) => item.kind);
    expect(kinds[0]).toBe("relationship_paused");
    expect(kinds).toContain("grant_received");
    expect(kinds).toContain("invite_accepted");
    const dates = cockpit.activity.map((item) => item.at);
    expect([...dates].sort().reverse()).toEqual(dates);
  });
});

describe("atividade", () => {
  it("grants concedidos no mesmo minuto viram um evento so", () => {
    const cockpit = buildCockpit({
      verification: verified,
      relationships: [
        relationship({
          grants: [
            grant({ scope: "emotional", grantedAt: "2026-09-22T10:00:05Z" }),
            grant({ scope: "sleep", grantedAt: "2026-09-22T10:00:40Z" }),
            grant({ scope: "goals", grantedAt: "2026-09-23T08:00:00Z" }),
          ],
        }),
      ],
      invites: [],
      scopeLabel: label,
      now: NOW,
    });
    const received = cockpit.activity.filter((item) => item.kind === "grant_received");
    expect(received.map((item) => item.title)).toEqual([
      "Acesso concedido: goals",
      "Acesso concedido a 2 escopos",
    ]);
  });
});

describe("acompanhamentos", () => {
  const list = [
    relationship({ displayName: "Érica Souza", updatedAt: "2026-09-12T10:00:00Z" }),
    relationship({ displayName: "Bruno", status: "paused", pausedAt: "2026-09-20T10:00:00Z" }),
    relationship({ displayName: null, status: "ended", endedAt: "2026-09-21T10:00:00Z" }),
  ];

  it("busca ignora acento e caixa, e nunca casa pessoa sem nome visivel", () => {
    expect(filterRelationships(list, { filter: "all", query: "erica", sort: "recent" }).map((r) => r.displayName)).toEqual([
      "Érica Souza",
    ]);
    expect(filterRelationships(list, { filter: "all", query: "pessoa", sort: "recent" })).toEqual([]);
  });

  it("filtro por estado e ordenacao", () => {
    expect(filterRelationships(list, { filter: "closed", query: "", sort: "recent" })).toHaveLength(1);
    expect(filterRelationships(list, { filter: "all", query: "", sort: "name" }).map((r) => r.displayName)).toEqual([
      "Bruno",
      "Érica Souza",
      null,
    ]);
    expect(filterRelationships(list, { filter: "all", query: "", sort: "recent" })[0]?.status).toBe("ended");
  });

  it("escopos vigentes ignoram revogado, expirado e ainda nao iniciado", () => {
    const r = relationship({
      grants: [
        grant({ scope: "emotional" }),
        grant({ scope: "journal_entry", journalEntryId: "a" }),
        grant({ scope: "journal_entry", journalEntryId: "b" }),
        grant({ scope: "sleep", status: "revoked", revokedAt: "2026-09-21T10:00:00Z" }),
        grant({ scope: "goals", validUntil: "2026-09-24T11:00:00Z" }),
        grant({ scope: "cycle", validFrom: "2026-09-25T00:00:00Z" }),
      ],
    });
    expect(currentScopeCount(r, NOW)).toBe(2);
  });
});
