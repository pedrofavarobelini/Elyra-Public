import { z } from "zod";

/**
 * Inventario do titular — a resposta a "o que existe sobre mim".
 *
 * ## De onde vem o numero
 *
 * Do **mesmo** leitor que produz a exportacao do titular, dirigido pelo mesmo
 * registro de tabelas. Nao existe contagem paralela aqui, e isso e deliberado:
 * o registro do export tem um guarda de cobertura que reprova quando uma tabela
 * publica nova nao e classificada, entao o inventario herda essa completude em
 * vez de depender de alguem lembrar de atualizar uma segunda lista.
 *
 * A alternativa — consultar `count` tabela a tabela — exigiria reimplementar as
 * cinco estrategias de posse do registro (direta, por pai, por participante, por
 * conexao profissional e por catalogo referenciado). Duplicar justamente a parte
 * dificil e a forma mais confiavel de fazer as duas divergirem.
 *
 * ## O que o inventario nao mostra
 *
 * O que o export exclui: anotacao clinica do profissional (que e registro de
 * trabalho de terceiro), trilha de auditoria interna e estado operacional da
 * propria exclusao. A exclusao e declarada no export, e nao silenciosa.
 */

export const DATA_DOMAINS = [
  "conta",
  "emocional",
  "diario",
  "metas",
  "ciclo",
  "relatorios",
  "sessoes",
  "profissional",
  "notificacoes",
  "governanca",
] as const;

export const dataDomainSchema = z.enum(DATA_DOMAINS);
export type DataDomain = z.infer<typeof dataDomainSchema>;

export const DATA_DOMAIN_LABEL: Record<DataDomain, string> = {
  conta: "Conta e preferências",
  emocional: "Registros emocionais",
  diario: "Diário",
  metas: "Metas",
  ciclo: "Ciclo",
  relatorios: "Relatórios e leituras da IA",
  sessoes: "Sessões multimodais",
  profissional: "Profissional",
  notificacoes: "Notificações",
  governanca: "Consentimento e governança",
};

export const DATA_DOMAIN_DESCRIPTION: Record<DataDomain, string> = {
  conta: "Seu nome, e-mail e as escolhas que definem como a Elyra se comporta.",
  emocional: "Check-ins, fatores associados e registros de sono.",
  diario: "Suas anotações e as etiquetas que você usa nelas.",
  metas: "Metas e o progresso que você registrou nelas.",
  ciclo: "Perfil, períodos, registros diários e sintomas do ciclo.",
  relatorios: "Relatórios que você salvou e leituras que a IA produziu.",
  sessoes:
    "Sessões, transcrições, sinais medidos, gravações autorizadas e interpretações.",
  profissional: "Conexões, permissões concedidas e o registro de cada acesso.",
  notificacoes: "Avisos que você recebeu e como você quer ser avisada.",
  governanca: "Consentimentos concedidos e revogados, e envios para aprendizado.",
};

/**
 * Tabela -> dominio.
 *
 * Mapa **fechado e completo**: o teste companheiro reprova se uma tabela do
 * registro de export ficar sem dominio, e tambem se aparecer aqui um nome que o
 * registro nao conhece. Um `?? "outros"` faria tabela nova cair num balde
 * generico sem ninguem perceber — que e como um dado pessoal novo deixa de ser
 * mostrado a quem ele descreve.
 */
export const TABLE_DOMAIN: Record<string, DataDomain> = {
  profiles: "conta",
  user_preferences: "conta",
  notification_preferences: "notificacoes",
  notifications: "notificacoes",
  /*
    O registro do que foi enviado por e-mail. Cabe em `notificacoes` porque a
    descricao do dominio ja e exatamente isto — "avisos que voce recebeu e como
    voce quer ser avisada": a primeira metade e esta tabela, a segunda e a
    matriz de preferencia. Separa-las em dominios diferentes afastaria o aviso
    da escolha que o governa.
  */
  email_deliveries: "notificacoes",

  consent_events: "governanca",
  /*
    Mesmo dominio de `consent_events`, e pela mesma razao: e consentimento do
    titular. A diferenca e temporal — aqui ele ainda nao virou evento —, e nao
    de natureza.
  */
  pending_consents: "governanca",
  learning_exports: "governanca",

  emotional_checkins: "emocional",
  emotional_checkin_factors: "emocional",
  emotional_factors: "emocional",
  sleep_records: "emocional",

  journal_entries: "diario",
  journal_entry_tags: "diario",
  journal_tags: "diario",

  goals: "metas",
  goal_progress_entries: "metas",

  cycle_profiles: "ciclo",
  cycle_periods: "ciclo",
  cycle_daily_records: "ciclo",
  cycle_daily_symptoms: "ciclo",
  cycle_symptoms: "ciclo",

  report_snapshots: "relatorios",
  ai_insights: "relatorios",

  professional_profiles: "profissional",
  professional_connections: "profissional",
  professional_access_log: "profissional",
  professional_reviewers: "profissional",
  professional_invites: "profissional",
  professional_public_profiles: "profissional",
  professional_onboarding: "profissional",
  professional_credentials: "profissional",

  appointments: "profissional",
  // Verificacao V2 (ADR-0028): evidencia estruturada, sem documento nem CPF.
  professional_verification_evidence: "profissional",

  help_requests: "profissional",
  professional_availability_rules: "profissional",
  professional_availability_exceptions: "profissional",
  professional_availability_weeks: "profissional",

  professional_sessions: "profissional",
  session_participants: "profissional",
  professional_session_events: "profissional",
  sharing_permissions: "profissional",

  multimodal_sessions: "sessoes",
  media_assets: "sessoes",
  processing_jobs: "sessoes",
  session_transcripts: "sessoes",
  session_modality_coverage: "sessoes",
  derived_features: "sessoes",
  session_self_reports: "sessoes",
  session_signal_windows: "sessoes",
  session_feedback: "sessoes",
  transcript_corrections: "sessoes",
  session_transcript_segments: "sessoes",
  session_interpretations: "sessoes",
};

export const inventoryTableSchema = z
  .object({
    table: z.string().min(1),
    records: z.number().int().min(0),
  })
  .strict();

export const inventoryDomainSchema = z
  .object({
    domain: dataDomainSchema,
    label: z.string().min(1),
    description: z.string().min(1),
    records: z.number().int().min(0),
    tables: z.array(inventoryTableSchema),
  })
  .strict();

export const dataInventorySchema = z
  .object({
    domains: z.array(inventoryDomainSchema),
    total: z.number().int().min(0),
    /** Tabelas que o export declara fora, para o inventario nao fingir completude. */
    excluded: z.array(z.string()),
  })
  .strict();

export type DataInventory = z.infer<typeof dataInventorySchema>;

export const EMPTY_DATA_INVENTORY: DataInventory = {
  domains: [],
  total: 0,
  excluded: [],
};

/**
 * Conta o que o leitor do export devolveu, agrupado por dominio.
 *
 * Dominio sem nenhum registro **aparece com zero**, e nao some. "Voce nao tem
 * nada de ciclo" e uma resposta; a ausencia da linha deixaria a pessoa sem saber
 * se o dominio nao existe, nao se aplica, ou simplesmente nao foi mostrado.
 */
export function buildDataInventory(
  data: Record<string, unknown[]>,
  excluded: readonly string[] = [],
): DataInventory {
  const porDominio = new Map<DataDomain, { table: string; records: number }[]>();
  for (const domain of DATA_DOMAINS) porDominio.set(domain, []);

  for (const [table, rows] of Object.entries(data)) {
    const domain = TABLE_DOMAIN[table];
    // Tabela sem dominio nao e silenciada: o teste de completude reprova antes
    // de isso chegar em producao, e aqui ela seria contada em lugar nenhum.
    if (!domain) continue;
    porDominio.get(domain)?.push({ table, records: rows.length });
  }

  const domains = DATA_DOMAINS.map((domain) => {
    const tables = (porDominio.get(domain) ?? []).sort((a, b) =>
      a.table.localeCompare(b.table),
    );
    return {
      domain,
      label: DATA_DOMAIN_LABEL[domain],
      description: DATA_DOMAIN_DESCRIPTION[domain],
      records: tables.reduce((sum, item) => sum + item.records, 0),
      tables,
    };
  });

  return dataInventorySchema.parse({
    domains,
    total: domains.reduce((sum, domain) => sum + domain.records, 0),
    excluded: [...excluded],
  });
}
