import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/lib/supabase/database.types";
import {
  SubjectExportRegistryError,
  readSubjectExportData,
} from "@/server/subject-export/exporter";
import {
  SUBJECT_EXPORT_EXCLUSIONS,
  SUBJECT_EXPORT_REGISTRY,
  evaluateSubjectExportCoverage,
  type SubjectExportDescriptor,
} from "@/server/subject-export/registry";

type Row = Record<string, unknown>;
type Filter =
  | { kind: "eq"; column: string; value: string }
  | { kind: "in"; column: string; values: string[] }
  | { kind: "or"; clauses: Array<{ column: string; value: string }> };

class FakeQuery implements PromiseLike<{ data: Row[] | null; error: unknown }> {
  private readonly filters: Filter[] = [];
  private readonly orders: Array<{ column: string; ascending: boolean }> = [];
  private from = 0;
  private to = Number.MAX_SAFE_INTEGER;

  constructor(
    private readonly table: string,
    private readonly rows: Row[],
    private readonly fail: boolean,
  ) {}

  eq(column: string, value: string) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  in(column: string, values: string[]) {
    this.filters.push({ kind: "in", column, values });
    return this;
  }

  or(raw: string) {
    this.filters.push({
      kind: "or",
      clauses: raw.split(",").map((clause) => {
        const match = clause.match(/^([a-z_]+)\.eq\.(.+)$/);
        if (!match?.[1] || !match[2]) throw new Error(`Filtro fake invalido: ${raw}`);
        return { column: match[1], value: match[2] };
      }),
    });
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.orders.push({ column, ascending: options.ascending });
    return this;
  }

  range(from: number, to: number) {
    this.from = from;
    this.to = to;
    return this;
  }

  then<TResult1 = { data: Row[] | null; error: unknown }, TResult2 = never>(
    onfulfilled?:
      | ((
          value: { data: Row[] | null; error: unknown },
        ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    if (this.fail) {
      return Promise.resolve({ data: null, error: new Error(this.table) }).then(
        onfulfilled,
        onrejected,
      );
    }

    const filtered = this.rows.filter((row) =>
      this.filters.every((filter) => {
        if (filter.kind === "eq") return row[filter.column] === filter.value;
        if (filter.kind === "in") {
          return filter.values.includes(String(row[filter.column]));
        }
        return filter.clauses.some(
          (clause) => row[clause.column] === clause.value,
        );
      }),
    );
    filtered.sort((left, right) => {
      for (const order of this.orders) {
        const a = String(left[order.column] ?? "\uffff");
        const b = String(right[order.column] ?? "\uffff");
        if (a === b) continue;
        const compared = a < b ? -1 : 1;
        return order.ascending ? compared : -compared;
      }
      return 0;
    });

    return Promise.resolve({
      data: filtered.slice(this.from, this.to + 1),
      error: null,
    }).then(onfulfilled, onrejected);
  }
}

function fakeClient(
  rows: Record<string, Row[]>,
  failures: string[] = [],
): SupabaseClient<Database> {
  return {
    // `self_rpc`: a RPC ja filtra pela conta autenticada e omite campos internos.
    rpc(fn: string) {
      const table = fn === "export_my_verification_evidence" ? "professional_verification_evidence" : fn;
      return Promise.resolve(
        failures.includes(table)
          ? { data: null, error: { code: "42501" } }
          : { data: [...(rows[table] ?? [])].map((row) => {
                const copy = { ...row };
                delete copy.value_digest;
                return copy;
              }), error: null },
      );
    },
    from(table: string) {
      return {
        select() {
          return new FakeQuery(
            table,
            [...(rows[table] ?? [])],
            failures.includes(table),
          );
        },
      };
    },
  } as unknown as SupabaseClient<Database>;
}

function descriptor(table: string): SubjectExportDescriptor {
  const found = SUBJECT_EXPORT_REGISTRY.find((item) => item.table === table);
  if (!found) throw new Error(`Descriptor ausente: ${table}`);
  return found;
}

function publicTablesFromGeneratedTypes(): string[] {
  const source = readFileSync(
    resolve(process.cwd(), "src/lib/supabase/database.types.ts"),
    "utf8",
  );
  const tables = source.match(/    Tables: \{([\s\S]*?)    Views: \{/)?.[1];
  if (!tables) throw new Error("Bloco Tables nao encontrado nos tipos gerados.");
  return [...tables.matchAll(/^      ([a-z0-9_]+): \{$/gm)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

describe("coverage guard nominal do subject export", () => {
  const publicTables = publicTablesFromGeneratedTypes();
  const included = SUBJECT_EXPORT_REGISTRY.map((item) => item.table);
  const excluded = SUBJECT_EXPORT_EXCLUSIONS.map((item) => item.table);

  // A contagem e atualizada **a mao** de proposito. Ela e o que obriga quem cria
  // uma tabela a decidir se ela entra no export do titular, em vez de deixar o


  // `session_modality_coverage`: 35 -> 36 tabelas, 31 -> 32 incluidas. A 22B
  // acrescentou `session_signal_windows` e `session_transcript_segments`:
  // 36 -> 38 tabelas, 32 -> 34 incluidas. A 22C acrescentou
  // `session_self_reports`: 38 -> 39 tabelas, 34 -> 35 incluidas.

  // tabelas, 35 -> 37 incluidas. As duas SAEM no export: quem avaliou e quem
  // corrigiu foi o titular, e um dado sobre a pessoa que a propria pessoa nao
  // pode ver seria exatamente o que o direito de acesso existe para impedir.

  // incluidas. Ela ENTRA no export: como a pessoa quer ser interrompida e uma
  // escolha dela sobre a propria atencao.

  // tabelas, 38 -> 40 incluidas. As DUAS entram. A primeira e o aceite da
  // propria pessoa enquanto ele ainda nao virou `consent_events`; a segunda e o

  // export algo a que se deu acesso de leitura seria incoerente.

  // no export porque contem salt e verificador do PIN; entregar esse material
  // ampliaria ataque offline e nao acrescenta dado de jornada da pessoa.

  // propria pessoa) e `professional_verifications` (NAO entra: trilha
  // administrativa sem grant nem para o profissional; o estado vigente ja sai
  // em `professional_profiles`): 45 -> 47 tabelas, 40 -> 41 incluidas.

  // sem `token_digest`. 47 -> 48 tabelas, 41 -> 42 incluidas.

  // publicacao do proprio profissional) e `professional_directory_access` (NAO
  // entra: contador anti-abuso efemero, conta + instante, 10 minutos, sem termo
  // buscado): 48 -> 50 tabelas, 42 -> 43 incluidas, 6 -> 7 excluidas.

  // operacional do dispatcher, sem user_id nem conteudo): 50 -> 51 tabelas,
  // 7 -> 8 excluidas. `email_deliveries` continua entrando.

  // participantes, sem a chave de idempotencia) e
  // `professional_availability_rules` (ENTRA para o profissional): 51 -> 53
  // tabelas, 43 -> 45 incluidas.

  // e `professional_session_events` (ENTRAM) e `session_access_credentials`
  // (NAO entra: digest efemero): 53 -> 57 tabelas, 45 -> 48 incluidas,
  // 8 -> 9 excluidas.

  // `professional_credentials` (ENTRAM: rascunho e credenciais da propria
  // pessoa): 57 -> 59 tabelas, 48 -> 50 incluidas.

  // escreveu; o profissional nao leva o texto no proprio export): 59 -> 60
  // tabelas, 50 -> 51 incluidas.
  // Verificacao V2 (ADR-0028) acrescentou `professional_verification_evidence`
  // (ENTRA, sem o digest) e `professional_verification_settings`,
  // `education_registry_snapshots`, `education_registry_courses` (NAO entram:
  // configuracao e dado aberto publico, sem pessoa): 60 -> 64 tabelas,
  // 51 -> 52 incluidas, 9 -> 12 excluidas.
  // UX F6 acrescentou `professional_availability_exceptions` (ENTRA para o
  // profissional; sem texto livre): 64 -> 65 tabelas, 52 -> 53 incluidas.
  // SUP-1 acrescentou cinco tabelas da Rede de Apoio (CNES), todas NAO entram:
  // dado institucional publico sem pessoa. 65 -> 70 tabelas, 12 -> 17 excluidas.
  //
  // Este guard ficou vermelho entre a criacao de `pending_consents` e esta
  // classificacao, sem ninguem perceber, porque so subconjuntos focados foram
  // executados no intervalo. E o lembrete de que suite focada acelera e nao
  // substitui: a guarda existe justamente para o que a atencao humana perde.
  it("classifica exatamente as 71 tabelas publicas, sem sobreposicao", () => {
    expect(publicTables).toHaveLength(71);
    expect(included).toHaveLength(54);
    expect(excluded).toHaveLength(17);
    expect(evaluateSubjectExportCoverage(publicTables)).toEqual({
      ok: true,
      missing: [],
      unknown: [],
      duplicates: [],
    });
  });

  it("as tabelas da Era 5 saem no export do titular", () => {
    /*
      Assercao nominal, e nao apenas contagem: um numero certo pode esconder uma
      troca — uma tabela entrando enquanto outra sai sem ninguem notar.
    */
    expect(included).toContain("pending_consents");
    expect(included).toContain("email_deliveries");
    expect(included).toContain("notification_preferences");
  });

  it("não exporta salt nem verificador do PIN do App Lock", () => {
    const exclusion = SUBJECT_EXPORT_EXCLUSIONS.find(
      (item) => item.table === "app_lock_sessions",
    );
    expect(exclusion?.reason).toContain("verificador de PIN");
    expect(included).not.toContain("app_lock_sessions");
  });

  it("a preferencia de e-mail sai pela mesma porta das demais", () => {
    // Nao ha export especial para o canal novo: as linhas `channel = 'email'`
    // sao linhas de `notification_preferences`, e saem com ela.
    const preferencias = SUBJECT_EXPORT_REGISTRY.find(
      (item) => item.table === "notification_preferences",
    );
    expect(preferencias?.ownership).toEqual({ kind: "direct", column: "user_id" });
    expect(preferencias?.transform).toBeUndefined();
  });

  it("o registro de entrega nao carrega a chave interna de janela", () => {
    // Mesmo criterio ja aplicado a `notifications`: `event_key` e mecanismo de
    // deduplicacao, e nao dado do titular.
    const entregas = SUBJECT_EXPORT_REGISTRY.find(
      (item) => item.table === "email_deliveries",
    );
    expect(entregas?.transform).toEqual({
      kind: "omit_fields",
      fields: ["event_key"],
    });
  });

  it("o perfil exportado nao revela o caminho interno da foto", () => {
    const profile = SUBJECT_EXPORT_REGISTRY.find((item) => item.table === "profiles");
    expect(profile?.transform).toEqual({
      kind: "omit_fields",
      fields: ["avatar_path"],
    });
  });

  it("falha por nome quando uma tabela nova ou esquecida nao e classificada", () => {
    const mutated = included.filter((table) => table !== "notifications");
    expect(
      evaluateSubjectExportCoverage(publicTables, mutated, excluded),
    ).toEqual({
      ok: false,
      missing: ["notifications"],
      unknown: [],
      duplicates: [],
    });
  });

  it("falha para classificacao duplicada e nome inventado", () => {
    const result = evaluateSubjectExportCoverage(
      publicTables,
      [...included, "notifications", "future_private_table"],
      excluded,
    );
    expect(result.ok).toBe(false);
    expect(result.duplicates).toEqual(["notifications"]);
    expect(result.unknown).toEqual(["future_private_table"]);
  });
});

describe("roteamento de ownership do subject export", () => {
  const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const P = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const C = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
  const rows: Record<string, Row[]> = {
    profiles: [
      { user_id: A, display_name: "A", avatar_path: `${A}/profile/private.webp` },
      { user_id: B, display_name: "B" },
      { user_id: P, display_name: "P" },
    ],
    emotional_checkins: [
      { id: "check-a", user_id: A, occurred_at: "2026-08-28T09:00:00Z" },
      { id: "check-b", user_id: B, occurred_at: "2026-08-28T08:00:00Z" },
    ],
    emotional_checkin_factors: [
      { checkin_id: "check-a", factor_id: "factor-system-used" },
      { checkin_id: "check-b", factor_id: "factor-b" },
    ],
    emotional_factors: [
      {
        id: "factor-a-unused",
        owner_user_id: A,
        origin: "custom",
        label: "Custom A",
      },
      {
        id: "factor-b",
        owner_user_id: B,
        origin: "custom",
        label: "Custom B",
      },
      {
        id: "factor-system-used",
        owner_user_id: null,
        origin: "system",
        label: "System used",
      },
      {
        id: "factor-system-unrelated",
        owner_user_id: null,
        origin: "system",
        label: "System unrelated",
      },
    ],
    professional_profiles: [
      { user_id: P, registration_number: "QA", created_at: "2026-08-28T00:00:00Z" },
    ],
    professional_connections: [
      {
        id: "connection-a-p",
        client_user_id: A,
        professional_user_id: P,
        invited_at: "2026-08-28T10:00:00Z",
      },
      {
        id: "connection-c-a",
        client_user_id: C,
        professional_user_id: A,
        invited_at: "2026-08-28T11:00:00Z",
      },
      {
        id: "connection-b-p",
        client_user_id: B,
        professional_user_id: P,
        invited_at: "2026-08-28T12:00:00Z",
      },
    ],
    sharing_permissions: [
      {
        id: "permission-a",
        connection_id: "connection-a-p",
        granted_at: "2026-08-28T10:01:00Z",
      },
      {
        id: "permission-c",
        connection_id: "connection-c-a",
        granted_at: "2026-08-28T11:01:00Z",
      },
      {
        id: "permission-b",
        connection_id: "connection-b-p",
        granted_at: "2026-08-28T12:01:00Z",
      },
    ],
    media_assets: [
      {
        id: "asset-a",
        user_id: A,
        storage_path: `${A}/multimodal/session/asset.webm`,
        created_at: "2026-08-28T13:00:00Z",
      },
    ],
    notifications: [
      {
        id: "notification-new",
        user_id: A,
        kind: "goal_reminder",
        event_key: "goal:2026-08-28",
        read_at: "2026-08-28T15:00:00Z",
        created_at: "2026-08-28T15:00:00Z",
      },
      {
        id: "notification-old",
        user_id: A,
        kind: "checkin_reminder",
        event_key: "checkin:2026-08-27",
        read_at: null,
        created_at: "2026-08-27T15:00:00Z",
      },
      {
        id: "notification-b",
        user_id: B,
        kind: "goal_reminder",
        event_key: "goal:2026-08-28",
        read_at: null,
        created_at: "2026-08-28T16:00:00Z",
      },
    ],
  };

  it("separa direct, parent, participant, client-connection e catalog related", async () => {
    const data = await readSubjectExportData(fakeClient(rows), A);

    expect(data.profiles).toEqual([
      expect.objectContaining({ user_id: A }),
    ]);
    expect(data.profiles?.[0]).not.toHaveProperty("avatar_path");
    expect(data.emotional_checkins).toEqual([
      expect.objectContaining({ id: "check-a" }),
    ]);
    expect(data.emotional_checkin_factors).toEqual([
      { checkin_id: "check-a", factor_id: "factor-system-used" },
    ]);
    expect(data.emotional_factors).toEqual([
      expect.objectContaining({ id: "factor-a-unused" }),
      expect.objectContaining({ id: "factor-system-used" }),
    ]);
    expect(data.professional_connections).toEqual([
      expect.objectContaining({ id: "connection-a-p" }),
      expect.objectContaining({ id: "connection-c-a" }),
    ]);
    expect(data.sharing_permissions).toEqual([
      expect.objectContaining({ id: "permission-a" }),
    ]);
  });

  it("export do profissional nao absorve saude nem permissions do paciente", async () => {
    const data = await readSubjectExportData(fakeClient(rows), P);
    expect(data.professional_profiles).toEqual([
      expect.objectContaining({ user_id: P }),
    ]);
    expect(data.professional_connections).toHaveLength(2);
    expect(data.emotional_checkins).toEqual([]);
    expect(data.sharing_permissions).toEqual([]);
  });

  it("preserva read_at, remove dedupe/path internos e ordena arrays", async () => {
    const data = await readSubjectExportData(fakeClient(rows), A);
    expect(data.notifications).toEqual([
      expect.objectContaining({
        id: "notification-old",
        read_at: null,
      }),
      expect.objectContaining({
        id: "notification-new",
        read_at: "2026-08-28T15:00:00Z",
      }),
    ]);
    for (const notification of data.notifications ?? []) {
      expect(notification).not.toHaveProperty("event_key");
    }
    expect(data.media_assets?.[0]).not.toHaveProperty("storage_path");
  });

  it("pagina alem de 500 linhas sem truncar", async () => {
    const notifications = Array.from({ length: 501 }, (_, index) => ({
      id: `notification-${String(index).padStart(3, "0")}`,
      user_id: A,
      event_key: `event-${index}`,
      created_at: `2026-08-28T${String(index % 24).padStart(2, "0")}:00:00Z`,
      read_at: null,
    }));
    const data = await readSubjectExportData(
      fakeClient({ notifications }),
      A,
      [descriptor("notifications")],
    );
    expect(data.notifications).toHaveLength(501);
  });

  it("aceita recurso vazio como resultado valido", async () => {
    await expect(
      readSubjectExportData(fakeClient({}), A, [descriptor("notifications")]),
    ).resolves.toEqual({ notifications: [] });
  });

  it("falha se uma dependencia nao foi executada", async () => {
    await expect(
      readSubjectExportData(fakeClient(rows), A, [
        descriptor("emotional_checkin_factors"),
      ]),
    ).rejects.toMatchObject({
      code: "EXPORT_DEPENDENCY_UNRESOLVED",
      table: "emotional_checkins",
    });
  });

  it("falha para descriptor duplicado, cardinalidade invalida e erro de leitura", async () => {
    await expect(
      readSubjectExportData(fakeClient(rows), A, [
        descriptor("profiles"),
        descriptor("profiles"),
      ]),
    ).rejects.toBeInstanceOf(SubjectExportRegistryError);

    await expect(
      readSubjectExportData(
        fakeClient({ profiles: [...rows.profiles!, { user_id: A }] }),
        A,
        [descriptor("profiles")],
      ),
    ).rejects.toMatchObject({ code: "EXPORT_CARDINALITY_VIOLATION" });

    await expect(
      readSubjectExportData(fakeClient({}, ["notifications"]), A, [
        descriptor("notifications"),
      ]),
    ).rejects.toMatchObject({ code: "EXPORT_READ_FAILED" });
  });
  it("falha fechado para uma strategy que ninguem classificou", async () => {
    const bogus = {
      ...descriptor("notifications"),
      ownership: { kind: "telepatia", column: "user_id" },
    } as unknown as SubjectExportDescriptor;

    await expect(
      readSubjectExportData(fakeClient(rows), A, [bogus]),
    ).rejects.toMatchObject({
      code: "EXPORT_STRATEGY_UNKNOWN",
      table: "notifications",
    });
  });

  it("nenhum identificador de outro titular sobrevive ao export completo", async () => {
    const exportA = JSON.stringify(await readSubjectExportData(fakeClient(rows), A));
    expect(exportA).toContain(A);
    expect(exportA).not.toContain(B);

    const exportB = JSON.stringify(await readSubjectExportData(fakeClient(rows), B));
    expect(exportB).toContain(B);
    expect(exportB).not.toContain(C);
  });
});
