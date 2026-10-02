import type { Database } from "@/lib/supabase/database.types";

export type PublicTableName = Extract<
  keyof Database["public"]["Tables"],
  string
>;

type RowFor<T extends PublicTableName> =
  Database["public"]["Tables"][T]["Row"];
export type ColumnName<T extends PublicTableName> = Extract<
  keyof RowFor<T>,
  string
>;

export type ExportSensitivity =
  | "identity"
  | "preferences"
  | "governance"
  | "emotional_health"
  | "sleep_health"
  | "private_journal"
  | "goals"
  | "reproductive_health"
  | "health_analytics"
  | "professional_relationship"
  | "multimodal_sensitive"
  | "multimodal_operational"
  | "learning_governance"
  | "operational_communication";

export type ExpectedCardinality = "zero_or_one" | "zero_or_many";

export interface ExportOrderRule {
  column: string;
  ascending: boolean;
}

export type ExportTransform = {
  kind: "omit_fields";
  fields: readonly string[];
};

export type OwnershipStrategy =
  | {
      kind: "direct";
      column: string;
    }
  | {
      kind: "parent";
      foreignKey: string;
      parentTable: PublicTableName;
      parentKey: string;
    }
  | {
      kind: "participant";
      columns: readonly [string, string];
    }
  | {
      kind: "client_connection";
      foreignKey: string;
      connectionTable: "professional_connections";
      connectionKey: "id";
      clientColumn: "client_user_id";
    }
  | {
      /*
       * Tabela sem grant de leitura para o titular (ex.: evidencia de
       * verificacao, ADR-0028): o export chama uma RPC propria, que devolve so
       * as linhas da conta e ja sem os campos internos.
       */
      kind: "self_rpc";
      fn: "export_my_verification_evidence";
    }
  | {
      kind: "owned_or_referenced_catalog";
      ownerColumn: string;
      idColumn: string;
      linkTable: PublicTableName;
      linkReferenceColumn: string;
    };

export interface SubjectExportDescriptor {
  table: PublicTableName;
  exportable: true;
  sensitivity: ExportSensitivity;
  cardinality: ExpectedCardinality;
  ownership: OwnershipStrategy;
  order: readonly ExportOrderRule[];
  transform?: ExportTransform;
}

type CommonDescriptor<T extends PublicTableName> = {
  table: T;
  sensitivity: ExportSensitivity;
  cardinality: ExpectedCardinality;
  order: readonly {
    column: ColumnName<T>;
    ascending: boolean;
  }[];
  transform?: {
    kind: "omit_fields";
    fields: readonly ColumnName<T>[];
  };
};

function direct<T extends PublicTableName>(
  descriptor: CommonDescriptor<T> & { column: ColumnName<T> },
): SubjectExportDescriptor {
  const { column, ...common } = descriptor;
  return {
    ...common,
    exportable: true,
    ownership: { kind: "direct", column },
  };
}

function parent<T extends PublicTableName, P extends PublicTableName>(
  descriptor: CommonDescriptor<T> & {
    foreignKey: ColumnName<T>;
    parentTable: P;
    parentKey: ColumnName<P>;
  },
): SubjectExportDescriptor {
  const { foreignKey, parentTable, parentKey, ...common } = descriptor;
  return {
    ...common,
    exportable: true,
    ownership: { kind: "parent", foreignKey, parentTable, parentKey },
  };
}

function participant<T extends PublicTableName>(
  descriptor: CommonDescriptor<T> & {
    columns: readonly [ColumnName<T>, ColumnName<T>];
  },
): SubjectExportDescriptor {
  const { columns, ...common } = descriptor;
  return {
    ...common,
    exportable: true,
    ownership: { kind: "participant", columns },
  };
}

function clientConnection<T extends PublicTableName>(
  descriptor: CommonDescriptor<T> & {
    foreignKey: ColumnName<T>;
  },
): SubjectExportDescriptor {
  const { foreignKey, ...common } = descriptor;
  return {
    ...common,
    exportable: true,
    ownership: {
      kind: "client_connection",
      foreignKey,
      connectionTable: "professional_connections",
      connectionKey: "id",
      clientColumn: "client_user_id",
    },
  };
}

function ownedOrReferencedCatalog<
  T extends PublicTableName,
  L extends PublicTableName,
>(
  descriptor: CommonDescriptor<T> & {
    ownerColumn: ColumnName<T>;
    idColumn: ColumnName<T>;
    linkTable: L;
    linkReferenceColumn: ColumnName<L>;
  },
): SubjectExportDescriptor {
  const {
    ownerColumn,
    idColumn,
    linkTable,
    linkReferenceColumn,
    ...common
  } = descriptor;
  return {
    ...common,
    exportable: true,
    ownership: {
      kind: "owned_or_referenced_catalog",
      ownerColumn,
      idColumn,
      linkTable,
      linkReferenceColumn,
    },
  };
}

/**
 * Ordem de execucao, nao so catalogo de nomes.
 *
 * Um descriptor que depende de pai ou link aparece depois da dependencia.
 * Isso permite distinguir "dependencia vazia" de "dependencia esquecida".
 */
export const SUBJECT_EXPORT_REGISTRY: readonly SubjectExportDescriptor[] = [
  direct({
    table: "profiles",
    column: "user_id",
    sensitivity: "identity",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
    transform: { kind: "omit_fields", fields: ["avatar_path"] },
  }),
  direct({
    table: "user_preferences",
    column: "user_id",
    sensitivity: "preferences",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),
  direct({
    /*
      A matriz canal x tipo e dado do titular: ela descreve como a pessoa quer
      ser interrompida, e uma escolha sobre a propria atencao e exatamente o
      tipo de coisa que o direito de acesso existe para tornar visivel.
    */
    table: "notification_preferences",
    column: "user_id",
    sensitivity: "preferences",
    cardinality: "zero_or_many",
    order: [
      { column: "kind", ascending: true },
      { column: "channel", ascending: true },
    ],
  }),
  direct({

    table: "email_deliveries",
    column: "user_id",
    sensitivity: "operational_communication",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["event_key"] },
  }),
  direct({
    table: "consent_events",
    column: "user_id",
    sensitivity: "governance",
    cardinality: "zero_or_many",
    order: [
      { column: "occurred_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({

    table: "pending_consents",
    column: "user_id",
    sensitivity: "governance",
    cardinality: "zero_or_many",
    order: [{ column: "purpose", ascending: true }],
  }),
  direct({
    table: "emotional_checkins",
    column: "user_id",
    sensitivity: "emotional_health",
    cardinality: "zero_or_many",
    order: [
      { column: "occurred_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  parent({
    table: "emotional_checkin_factors",
    foreignKey: "checkin_id",
    parentTable: "emotional_checkins",
    parentKey: "id",
    sensitivity: "emotional_health",
    cardinality: "zero_or_many",
    order: [
      { column: "checkin_id", ascending: true },
      { column: "factor_id", ascending: true },
    ],
  }),
  ownedOrReferencedCatalog({
    table: "emotional_factors",
    ownerColumn: "owner_user_id",
    idColumn: "id",
    linkTable: "emotional_checkin_factors",
    linkReferenceColumn: "factor_id",
    sensitivity: "emotional_health",
    cardinality: "zero_or_many",
    order: [
      { column: "origin", ascending: true },
      { column: "label", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "sleep_records",
    column: "user_id",
    sensitivity: "sleep_health",
    cardinality: "zero_or_many",
    order: [
      { column: "night", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "journal_entries",
    column: "user_id",
    sensitivity: "private_journal",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  parent({
    table: "journal_entry_tags",
    foreignKey: "entry_id",
    parentTable: "journal_entries",
    parentKey: "id",
    sensitivity: "private_journal",
    cardinality: "zero_or_many",
    order: [
      { column: "entry_id", ascending: true },
      { column: "tag_id", ascending: true },
    ],
  }),
  ownedOrReferencedCatalog({
    table: "journal_tags",
    ownerColumn: "owner_user_id",
    idColumn: "id",
    linkTable: "journal_entry_tags",
    linkReferenceColumn: "tag_id",
    sensitivity: "private_journal",
    cardinality: "zero_or_many",
    order: [
      { column: "origin", ascending: true },
      { column: "label", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "goals",
    column: "user_id",
    sensitivity: "goals",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  parent({
    table: "goal_progress_entries",
    foreignKey: "goal_id",
    parentTable: "goals",
    parentKey: "id",
    sensitivity: "goals",
    cardinality: "zero_or_many",
    order: [
      { column: "occurred_on", ascending: true },
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "cycle_profiles",
    column: "user_id",
    sensitivity: "reproductive_health",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),
  direct({
    table: "cycle_periods",
    column: "user_id",
    sensitivity: "reproductive_health",
    cardinality: "zero_or_many",
    order: [
      { column: "start_date", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "cycle_daily_records",
    column: "user_id",
    sensitivity: "reproductive_health",
    cardinality: "zero_or_many",
    order: [
      { column: "record_date", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  parent({
    table: "cycle_daily_symptoms",
    foreignKey: "record_id",
    parentTable: "cycle_daily_records",
    parentKey: "id",
    sensitivity: "reproductive_health",
    cardinality: "zero_or_many",
    order: [
      { column: "record_id", ascending: true },
      { column: "symptom_id", ascending: true },
    ],
  }),
  ownedOrReferencedCatalog({
    table: "cycle_symptoms",
    ownerColumn: "owner_user_id",
    idColumn: "id",
    linkTable: "cycle_daily_symptoms",
    linkReferenceColumn: "symptom_id",
    sensitivity: "reproductive_health",
    cardinality: "zero_or_many",
    order: [
      { column: "origin", ascending: true },
      { column: "label", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "report_snapshots",
    column: "user_id",
    sensitivity: "health_analytics",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "ai_insights",
    column: "user_id",
    sensitivity: "health_analytics",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "professional_profiles",
    column: "user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),

  direct({
    table: "professional_reviewers",
    column: "user_id",
    sensitivity: "governance",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),

  direct({
    table: "professional_invites",
    column: "professional_user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["token_digest"] },
  }),

  direct({
    table: "professional_public_profiles",
    column: "user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),

  direct({
    table: "professional_onboarding",
    column: "user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_one",
    order: [{ column: "user_id", ascending: true }],
  }),
  direct({
    table: "professional_credentials",
    column: "user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  participant({
    table: "professional_connections",
    columns: ["client_user_id", "professional_user_id"],
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "invited_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),

  participant({
    table: "appointments",
    columns: ["client_user_id", "professional_user_id"],
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "starts_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["idempotency_key"] },
  }),
  /*
   * Verificacao V2 (ADR-0028). A evidencia e sobre o proprio profissional e sai
   * para ele: fato, estado, tipo de fonte e datas. O digest do valor conferido
   * fica de fora — e tecnico e nao acrescenta nada que a pessoa ja nao saiba.
   */
  {

    // inteiro. A RPC ja omite `value_digest`; o transform fica como segunda trava.
    table: "professional_verification_evidence",
    exportable: true,
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    ownership: { kind: "self_rpc", fn: "export_my_verification_evidence" },
    order: [
      { column: "checked_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["value_digest"] },
  },

  direct({
    table: "help_requests",
    column: "client_user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["idempotency_key"] },
  }),
  // ADR-0035: publication metadata belongs to the professional too.
  direct({
    table: "professional_availability_weeks",
    column: "professional_user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [{ column: "week_start", ascending: true }],
  }),
  // UX F6: excecoes da agenda (sem texto livre) ENTRAM para o profissional.
  direct({
    table: "professional_availability_exceptions",
    column: "professional_user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "starts_on", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "professional_availability_rules",
    column: "professional_user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "weekday", ascending: true },
      { column: "start_minute", ascending: true },
      { column: "id", ascending: true },
    ],
  }),

  participant({
    table: "professional_sessions",
    columns: ["client_user_id", "professional_user_id"],
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "opens_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "session_participants",
    column: "user_id",
    sensitivity: "professional_relationship",
    cardinality: "zero_or_many",
    order: [
      { column: "session_id", ascending: true },
      { column: "user_id", ascending: true },
    ],
  }),
  direct({
    table: "professional_session_events",
    column: "subject_user_id",
    sensitivity: "governance",
    cardinality: "zero_or_many",
    order: [
      { column: "occurred_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  /*
   * A trilha de acesso profissional e do **titular**: ela descreve o que
   * aconteceu com o dado dele. `direct` por `client_user_id`, e nao
   * `participant`: o profissional aparece na linha, mas nao e dono dela - e a
   * mesma distincao que `L-058` custou caro para aprender.
   *
   * Sensibilidade `governance` e nao `professional_relationship`: a linha nao
   * revela conteudo nenhum, so quem abriu qual dominio e quando.
   */
  direct({
    table: "professional_access_log",
    column: "client_user_id",
    sensitivity: "governance",
    cardinality: "zero_or_many",
    order: [
      { column: "occurred_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  clientConnection({
    table: "sharing_permissions",
    foreignKey: "connection_id",
    sensitivity: "governance",
    cardinality: "zero_or_many",
    order: [
      { column: "granted_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "multimodal_sessions",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "started_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "media_assets",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["storage_path"] },
  }),
  direct({
    table: "processing_jobs",
    column: "user_id",
    sensitivity: "multimodal_operational",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "session_transcripts",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),

  direct({
    table: "session_modality_coverage",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "derived_features",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),


  direct({
    table: "session_self_reports",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "session_signal_windows",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),

  direct({
    table: "session_feedback",
    column: "user_id",
    sensitivity: "multimodal_operational",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),

  direct({
    table: "transcript_corrections",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "session_transcript_segments",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "session_interpretations",
    column: "user_id",
    sensitivity: "multimodal_sensitive",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "learning_exports",
    column: "user_id",
    sensitivity: "learning_governance",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
  }),
  direct({
    table: "notifications",
    column: "user_id",
    sensitivity: "operational_communication",
    cardinality: "zero_or_many",
    order: [
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ],
    transform: { kind: "omit_fields", fields: ["event_key"] },
  }),
] as const;

export interface SubjectExportExclusion {
  table: PublicTableName;
  exportable: false;
  reason: string;
}

export const SUBJECT_EXPORT_EXCLUSIONS = [
  {
    table: "app_lock_sessions",
    exportable: false,
    reason: "material de autenticacao local: salt e verificador de PIN",
  },
  {
    table: "account_deletions",
    exportable: false,
    reason: "lifecycle operacional interno da exclusao de conta",
  },
  {
    table: "audit_logs",
    exportable: false,
    reason: "trilha interna que sobrevive ao titular de forma anonimizada",
  },
  {
    table: "deletion_ledger",
    exportable: false,
    reason: "lapide operacional de restore, sem FK por desenho",
  },
  {
    table: "professional_verifications",
    exportable: false,
    reason:
      "trilha administrativa sem acesso direto (nem ao proprio profissional); o estado vigente sai em professional_profiles e o historico sem reviewer/digest em GET /api/professional/verification",
  },
  {
    table: "professional_directory_access",
    exportable: false,
    reason:
      "contador anti-abuso efemero da descoberta (conta + instante, retencao de 10 minutos), sem termo buscado nem perfil aberto",
  },
  {
    table: "session_access_credentials",
    exportable: false,
    reason:
      "credencial efemera da sessao profissional (PRO-7): so digest SHA-256, validade de 2 minutos, uso unico, apagada 1 h depois; segredo tecnico sem valor para o titular",
  },
  {
    table: "notification_dispatch_runs",
    exportable: false,
    reason:
      "batimento operacional do dispatcher de e-mail (Stage 29-C): contagens por execucao, sem user_id, e-mail ou conteudo; retencao de 30 dias",
  },
  {
    table: "professional_notes",
    exportable: false,
    reason:
      "registro privado profissional que pode conter dado sensivel de terceiro",
  },
  {
    table: "professional_verification_settings",
    exportable: false,
    reason: "configuracao do sistema, sem dado de pessoa",
  },
  {
    table: "education_registry_snapshots",
    exportable: false,
    reason: "metadado de importacao de dado aberto oficial, sem dado de pessoa",
  },
  {
    table: "education_registry_courses",
    exportable: false,
    reason: "cadastro publico de cursos do e-MEC, sem dado de pessoa",
  },
  // SUP-1 (ADR-0031): Rede de Apoio e dado institucional publico (CNES), sem pessoa.
  {
    table: "support_network_settings",
    exportable: false,
    reason: "interruptores de operacao da Rede de Apoio, sem dado de pessoa",
  },
  {
    table: "support_network_snapshots",
    exportable: false,
    reason: "metadado de importacao de dado oficial (CNES), sem dado de pessoa",
  },
  {
    table: "support_facility_types",
    exportable: false,
    reason: "vocabulario oficial de tipos de estabelecimento, sem dado de pessoa",
  },
  {
    table: "support_facility_categories",
    exportable: false,
    reason: "mapa versionado tipo oficial -> categoria de UX, sem dado de pessoa",
  },
  {
    table: "support_facilities",
    exportable: false,
    reason: "cadastro publico de estabelecimentos de saude (CNES), sem dado de pessoa",
  },
] as const satisfies readonly SubjectExportExclusion[];

export interface SubjectExportCoverage {
  ok: boolean;
  missing: string[];
  unknown: string[];
  duplicates: string[];
}

/**
 * Compara nomes, nao contagens. Aceita listas injetadas para que o proprio
 * guard possa ser testado por mutacao (remocao/duplicacao de classificacao).
 */
export function evaluateSubjectExportCoverage(
  publicTables: readonly string[],
  included: readonly string[] = SUBJECT_EXPORT_REGISTRY.map(
    (descriptor) => descriptor.table,
  ),
  excluded: readonly string[] = SUBJECT_EXPORT_EXCLUSIONS.map(
    (descriptor) => descriptor.table,
  ),
): SubjectExportCoverage {
  const publicSet = new Set(publicTables);
  const classifications = [...included, ...excluded];
  const classifiedSet = new Set(classifications);
  const counts = new Map<string, number>();
  for (const table of classifications) {
    counts.set(table, (counts.get(table) ?? 0) + 1);
  }

  const missing = [...publicSet]
    .filter((table) => !classifiedSet.has(table))
    .sort();
  const unknown = [...classifiedSet]
    .filter((table) => !publicSet.has(table))
    .sort();
  const duplicates = [...counts]
    .filter(([, count]) => count !== 1)
    .map(([table]) => table)
    .sort();

  return {
    ok: missing.length === 0 && unknown.length === 0 && duplicates.length === 0,
    missing,
    unknown,
    duplicates,
  };
}
