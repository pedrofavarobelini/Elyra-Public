import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { SupportSearch } from "@/lib/contracts/support-network";
import type { Database } from "@/lib/supabase/database.types";

import { normalizarCausa, registrarFalhaDeRepositorio } from "./repository-error";

type Client = SupabaseClient<Database>;

/**
 * Rede de Apoio (SUP-1). So leitura, e so pelas RPCs de projecao: o produto
 * nunca le as tabelas nem conhece o snapshot fisico. Escrita e do importador
 * (service_role, fora de `src/`, ADR-0031).
 */
export class SupportNetworkRepositoryError extends Error {
  readonly code?: string;
  readonly operation: string;

  constructor(operation: string, causa?: unknown) {
    super(`Falha no repositorio da Rede de Apoio: ${operation}.`);
    this.name = "SupportNetworkRepositoryError";
    this.operation = operation;
    const normalizada = normalizarCausa(causa);
    this.code = normalizada?.code;
    registrarFalhaDeRepositorio("rede-de-apoio", operation, normalizada);
  }
}

export async function readSupportProvenance(client: Client) {
  const { data, error } = await client.rpc("support_network_provenance");
  if (error) throw new SupportNetworkRepositoryError("provenance", error);
  return data?.[0] ?? null;
}

export async function searchSupportFacilities(client: Client, query: SupportSearch) {
  const { data, error } = await client.rpc("search_support_facilities", {
    p_municipality_code: query.municipalityCode,
    p_official_type_codes: query.officialTypeCodes,
    p_category: query.category,
    p_limit: query.limit,
    p_offset: query.offset,
  });
  if (error) throw new SupportNetworkRepositoryError("search", error);
  return data ?? [];
}

export async function readSupportFacility(client: Client, cnes: string) {
  const { data, error } = await client.rpc("get_support_facility", { p_cnes_code: cnes });
  if (error) throw new SupportNetworkRepositoryError("get", error);
  return data?.[0] ?? null;
}

export async function listSupportFacilityTypes(client: Client) {
  const { data, error } = await client.rpc("list_support_facility_types");
  if (error) throw new SupportNetworkRepositoryError("types", error);
  return data ?? [];
}

/** SUP-2: municipios com unidade no snapshot visivel (centro aproximado). */
export async function listSupportMunicipalities(client: Client) {
  const { data, error } = await client.rpc("list_support_municipalities");
  if (error) throw new SupportNetworkRepositoryError("municipalities", error);
  return data ?? [];
}

/** SUP-2: tipos oficiais presentes num municipio. */
export async function listSupportMunicipalityTypes(client: Client, municipalityCode: string) {
  const { data, error } = await client.rpc("list_support_municipality_types", {
    p_municipality_code: municipalityCode,
  });
  if (error) throw new SupportNetworkRepositoryError("municipality_types", error);
  return data ?? [];
}
