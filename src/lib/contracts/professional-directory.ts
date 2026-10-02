import { z } from "zod";

import type { VerificationStatus } from "@/lib/contracts/professional-verification";



export const UF_CODES = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA",
  "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
] as const;
export type UfCode = (typeof UF_CODES)[number];

export const DIRECTORY_MODALITIES = ["online", "in_person"] as const;
export type DirectoryModality = (typeof DIRECTORY_MODALITIES)[number];
export const MODALITY_LABEL: Record<DirectoryModality, string> = {
  online: "Online",
  in_person: "Presencial",
};

/** Temas de atuacao DECLARADOS pelo profissional. A Elyra nao os certifica. */
export const DIRECTORY_AREAS = [
  "ansiedade",
  "autoestima",
  "estresse",
  "luto",
  "relacionamentos",
  "familia",
  "trabalho_carreira",
  "sono_rotina",
  "adolescencia",
  "parentalidade",
  "diversidade",
  "transicoes",
] as const;
export type DirectoryArea = (typeof DIRECTORY_AREAS)[number];
export const AREA_LABEL: Record<DirectoryArea, string> = {
  ansiedade: "Ansiedade",
  autoestima: "Autoestima",
  estresse: "Estresse",
  luto: "Luto",
  relacionamentos: "Relacionamentos",
  familia: "Família",
  trabalho_carreira: "Trabalho e carreira",
  sono_rotina: "Sono e rotina",
  adolescencia: "Adolescência",
  parentalidade: "Parentalidade",
  diversidade: "Diversidade e identidade",
  transicoes: "Transições de vida",
};

export const DIRECTORY_LANGUAGES = ["pt", "en", "es", "libras"] as const;
export type DirectoryLanguage = (typeof DIRECTORY_LANGUAGES)[number];
export const LANGUAGE_LABEL: Record<DirectoryLanguage, string> = {
  pt: "Português",
  en: "Inglês",
  es: "Espanhol",
  libras: "Libras",
};

export const DIRECTORY_PAGE_SIZE = 12;
export const DIRECTORY_MAX_PAGE = 50;
export const DIRECTORY_SLUG = /^[0-9a-f]{16}$/;
export const DEMO_VERIFICATION_COPY = "Perfil de demonstração — verificação simulada para homologação.";

/**
 * Seeds aprovados usam um registro impossível de confundir com conselho real.
 * A UI deriva o aviso desse marcador já projetado pelas RPCs; nenhum privilégio,
 * policy ou estado de verificação é alterado.
 */
export function isDemoProfessionalRegistration(number: string | null | undefined) {
  return typeof number === "string" && number.toUpperCase().startsWith("DEMO-");
}

const trimmedOrNull = (max: number, min = 1) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .refine((value) => value === null || value.length >= min, `Use pelo menos ${min} caracteres.`)
    .nullable();

/** Edicao do perfil publico pelo proprio profissional. */
export const publicProfileInputSchema = z
  .object({
    listed: z.boolean(),
    displayName: trimmedOrNull(80, 2),
    bio: trimmedOrNull(600),
    city: trimmedOrNull(60, 2),
    state: z.enum(UF_CODES).nullable(),
    modalities: z.array(z.enum(DIRECTORY_MODALITIES)).max(2).transform((items) => [...new Set(items)]),
    areas: z.array(z.enum(DIRECTORY_AREAS)).max(6, "Escolha até 6 áreas.").transform((items) => [...new Set(items)]),
    languages: z.array(z.enum(DIRECTORY_LANGUAGES)).max(4).transform((items) => [...new Set(items)]),
  })
  .strict()
  .superRefine((input, ctx) => {
    if (!input.listed) return;
    const missing = publicProfileMissing(input);
    if (missing.length > 0) {
      ctx.addIssue({
        code: "custom",
        path: ["listed"],
        message: `Para aparecer na descoberta, preencha: ${missing.join(", ")}.`,
      });
    }
  });
export type PublicProfileInput = z.infer<typeof publicProfileInputSchema>;

export function publicProfileMissing(input: {
  displayName: string | null;
  city: string | null;
  state: string | null;
  modalities: readonly string[];
  areas: readonly string[];
  languages: readonly string[];
}): string[] {
  const missing: string[] = [];
  if (!input.displayName) missing.push("nome de exibição");
  if (!input.city) missing.push("cidade");
  if (!input.state) missing.push("UF");
  if (input.modalities.length === 0) missing.push("modalidade");
  if (input.areas.length === 0) missing.push("ao menos uma área");
  if (input.languages.length === 0) missing.push("idioma");
  return missing;
}

export type DiscoveryVisibility =
  | { visible: true }
  | { visible: false; reason: "verification" | "not_listed" | "incomplete"; message: string };

/**
 * Por que o perfil aparece ou nao, para o preview do proprio profissional.
 * Espelha a elegibilidade da RPC: verificacao vigente + opt-in + completo.
 */
export function discoveryVisibility(input: {
  verification: VerificationStatus | null;
  listed: boolean;
  missing: string[];
}): DiscoveryVisibility {
  if (input.verification !== "verified") {
    const why: Record<string, string> = {
      pending: "sua verificação está pendente",
      under_review: "sua verificação está em revisão",
      rejected: "o registro não foi confirmado",
      suspended: "a verificação está suspensa",
      expired_review: "a revisão da verificação venceu",
    };
    return {
      visible: false,
      reason: "verification",
      message: `Seu perfil ainda não aparece na descoberta porque ${why[input.verification ?? "pending"] ?? why.pending}.`,
    };
  }
  if (input.missing.length > 0) {
    return {
      visible: false,
      reason: "incomplete",
      message: `Seu perfil ainda não aparece porque falta: ${input.missing.join(", ")}.`,
    };
  }
  if (!input.listed) {
    return {
      visible: false,
      reason: "not_listed",
      message: "Seu perfil não aparece na descoberta: a exibição está desligada.",
    };
  }
  return { visible: true };
}

/**
 * Filtros vindos da URL. Valor fora do vocabulario ou fora dos limites e
 * descartado (vira "sem filtro"), e nao erro: URL adulterada nao derruba a
 * tela nem chega ao banco.
 */
export interface DirectorySearch {
  q: string | null;
  state: UfCode | null;
  city: string | null;
  modality: DirectoryModality | null;
  area: DirectoryArea | null;
  language: DirectoryLanguage | null;
  page: number;
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function boundedText(raw: string | undefined, max: number) {
  if (typeof raw !== "string") return null;
  const value = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/\s+/g, " ");
  if (value.length === 0 || value.length > max) return null;
  return value;
}

function member<T extends string>(list: readonly T[], raw: string | undefined): T | null {
  return typeof raw === "string" && (list as readonly string[]).includes(raw) ? (raw as T) : null;
}

export function parseDirectorySearch(params: Record<string, string | string[] | undefined>): DirectorySearch {
  const page = Number(first(params.pagina));
  return {
    q: boundedText(first(params.q), 60),
    state: member(UF_CODES, first(params.uf)),
    city: boundedText(first(params.cidade), 60),
    modality: member(DIRECTORY_MODALITIES, first(params.modalidade)),
    area: member(DIRECTORY_AREAS, first(params.area)),
    language: member(DIRECTORY_LANGUAGES, first(params.idioma)),
    page: Number.isInteger(page) && page >= 1 && page <= DIRECTORY_MAX_PAGE ? page : 1,
  };
}

/** Querystring canonica da busca (para paginacao e "limpar filtros"). */
export function directorySearchQuery(search: DirectorySearch, overrides: Partial<DirectorySearch> = {}) {
  const merged = { ...search, ...overrides };
  const query: Record<string, string> = {};
  if (merged.q) query.q = merged.q;
  if (merged.state) query.uf = merged.state;
  if (merged.city) query.cidade = merged.city;
  if (merged.modality) query.modalidade = merged.modality;
  if (merged.area) query.area = merged.area;
  if (merged.language) query.idioma = merged.language;
  if (merged.page > 1) query.pagina = String(merged.page);
  return query;
}

/** "CRP 06/123456" - o registro como o conselho o escreve. */
export function registrationLabel(council: string | null, region: string | null, number: string | null) {
  if (!number) return null;
  return `${council ?? "CRP"} ${region ? `${region}/` : ""}${number}`;
}
