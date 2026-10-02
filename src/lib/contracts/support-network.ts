import { z } from "zod";

/**
 * Rede de Apoio — contrato de consumo (SUP-1 -> SUP-2).
 *
 * O SUP-2 consome SO este contrato: nunca o schema fisico, o arquivo de origem
 * nem a API do CNES. Procedencia e frescor viajam com cada resposta.
 *
 * Regras de produto (ADR-0031): o tipo OFICIAL sempre aparece; a categoria de
 * UX so existe quando o mapeamento foi confirmado na fonte oficial; nada de
 * "aberto agora", vaga, emergencia ou "atende saude mental".
 */

export const SUPPORT_CATEGORIES = ["primary_care", "psychosocial_care", "urgent_care"] as const;
export const supportCategorySchema = z.enum(SUPPORT_CATEGORIES);
export type SupportCategory = z.infer<typeof supportCategorySchema>;

export const SUPPORT_SOURCES = ["cnes_download", "cnes_api", "qa_fixture"] as const;
export type SupportSource = (typeof SUPPORT_SOURCES)[number];

/**
 * Frescor: politica de dominio num unico lugar. A base do CNES e mensal
 * (competencia); ate 45 dias e o ciclo normal, ate 90 envelhece, depois disso
 * e antiga. Dado antigo NAO some: o SUP-2 decide como avisar.
 */
export const SUPPORT_FRESHNESS_POLICY = { currentMaxDays: 45, agingMaxDays: 90 } as const;
export type SupportFreshness = "CURRENT" | "AGING" | "STALE";

export function supportFreshness(ageDays: number): SupportFreshness {
  if (!Number.isFinite(ageDays) || ageDays < 0) return "STALE";
  if (ageDays <= SUPPORT_FRESHNESS_POLICY.currentMaxDays) return "CURRENT";
  if (ageDays <= SUPPORT_FRESHNESS_POLICY.agingMaxDays) return "AGING";
  return "STALE";
}

export const supportProvenanceSchema = z
  .object({
    source: z.enum(SUPPORT_SOURCES),
    /** Fixture de QA/demo: nunca apresentar como estabelecimento real. */
    isFixture: z.boolean(),
    referenceDate: z.string(),
    importedAt: z.string(),
    activatedAt: z.string().nullable(),
    facilityCount: z.number().int().nonnegative(),
    ageDays: z.number().int().nonnegative(),
    freshness: z.enum(["CURRENT", "AGING", "STALE"]),
    attribution: z.string(),
  })
  .strict();
export type SupportProvenance = z.infer<typeof supportProvenanceSchema>;

export const SUPPORT_ATTRIBUTION = {
  cnes_download: "Cadastro Nacional de Estabelecimentos de Saúde (CNES/DATASUS), Ministério da Saúde",
  cnes_api: "Cadastro Nacional de Estabelecimentos de Saúde (CNES), API de Dados Abertos do Ministério da Saúde",
  qa_fixture: "Dados fictícios de demonstração da Elyra (não são estabelecimentos reais)",
} as const satisfies Record<SupportSource, string>;

export const supportFacilitySchema = z
  .object({
    cnes: z.string().regex(/^[0-9]{7}$/),
    name: z.string(),
    officialType: z.object({ code: z.string(), name: z.string() }).strict(),
    category: supportCategorySchema.nullable(),
    municipality: z.object({ code: z.string(), name: z.string().nullable() }).strict(),
    state: z.string().length(2),
    address: z
      .object({
        street: z.string().nullable(),
        number: z.string().nullable(),
        complement: z.string().nullable(),
        district: z.string().nullable(),
        postalCode: z.string().nullable(),
      })
      .strict(),
    phone: z.object({ display: z.string(), digits: z.string().nullable() }).strict().nullable(),
    /** Coordenada da UNIDADE. Nunca a localizacao de quem busca. */
    coordinates: z.object({ latitude: z.number(), longitude: z.number() }).strict().nullable(),
    coordinateStatus: z.enum(["valid", "missing", "invalid"]),
    sourceActive: z.boolean().nullable(),
    sourceUpdatedAt: z.string().nullable(),
  })
  .strict();
export type SupportFacility = z.infer<typeof supportFacilitySchema>;

export const supportSearchSchema = z
  .object({
    municipalityCode: z.string().regex(/^[0-9]{6,7}$/, "Município inválido."),
    officialTypeCodes: z.array(z.string().regex(/^[0-9A-Za-z]{1,10}$/)).max(20).optional(),
    category: supportCategorySchema.optional(),
    limit: z.number().int().min(1).max(100).default(50),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type SupportSearch = z.infer<typeof supportSearchSchema>;

export type SupportSearchResult = {
  provenance: SupportProvenance | null;
  facilities: SupportFacility[];
};

/* ---------------------------------------------------------------------------
   SUP-2 — navegacao (lista + mapa). Consome o que esta acima; nada fisico.
   --------------------------------------------------------------------------- */

/** Municipio com unidade no snapshot visivel. `center` e aproximado (2 casas). */
export type SupportMunicipality = {
  code: string;
  name: string | null;
  state: string;
  facilityCount: number;
  center: { latitude: number; longitude: number } | null;
};

/** Tipo oficial presente no municipio. So vira filtro o que o dado sustenta. */
export type SupportMunicipalityType = {
  code: string;
  name: string;
  category: SupportCategory | null;
  facilityCount: number;
};

export const SUPPORT_PAGE_SIZE = 50;

/**
 * Pedido da busca (POST): so municipio, tipo oficial e pagina. Coordenada da
 * pessoa NAO existe aqui — o schema e `strict`, entao um campo extra (lat/lng)
 * e recusado com 400, nao ignorado em silencio.
 */
export const supportBrowseSchema = z
  .object({
    municipalityCode: z.string().regex(/^[0-9]{6,7}$/, "Município inválido."),
    officialTypeCode: z.string().regex(/^[0-9A-Za-z]{1,10}$/, "Tipo inválido.").optional(),
    offset: z.number().int().min(0).max(10000).default(0),
  })
  .strict();
export type SupportBrowse = z.infer<typeof supportBrowseSchema>;

export type SupportBrowseResult = {
  provenance: SupportProvenance | null;
  facilities: SupportFacility[];
  types: SupportMunicipalityType[];
  hasMore: boolean;
};
