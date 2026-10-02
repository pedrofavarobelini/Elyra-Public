import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  SUPPORT_ATTRIBUTION,
  SUPPORT_PAGE_SIZE,
  supportBrowseSchema,
  supportCategorySchema,
  supportFacilitySchema,
  supportFreshness,
  supportProvenanceSchema,
  supportSearchSchema,
  type SupportBrowseResult,
  type SupportFacility,
  type SupportMunicipality,
  type SupportMunicipalityType,
  type SupportProvenance,
  type SupportSearchResult,
  type SupportSource,
} from "@/lib/contracts/support-network";
import type { Database } from "@/lib/supabase/database.types";
import {
  listSupportFacilityTypes,
  listSupportMunicipalities,
  listSupportMunicipalityTypes,
  readSupportFacility,
  readSupportProvenance,
  searchSupportFacilities,
} from "@/server/repositories/support-network-repository";

type Client = SupabaseClient<Database>;

/**
 * Rede de Apoio (SUP-1) — o que o SUP-2 consome. Converte a projecao do banco
 * no contrato `SupportFacility` e anexa procedencia + frescor a toda resposta.
 * Nenhuma rota publica e criada aqui: a experiencia (mapa/lista) e do SUP-2.
 */

type FacilityRow = {
  cnes_code: string;
  official_name: string;
  official_type_code: string;
  official_type_name: string;
  category: string | null;
  municipality_code: string;
  municipality_name: string | null;
  state_code: string;
  postal_code: string | null;
  address_street: string | null;
  address_number: string | null;
  address_complement: string | null;
  address_district: string | null;
  phone_display: string | null;
  phone_digits: string | null;
  latitude: number | null;
  longitude: number | null;
  coordinate_status: string;
  source_active: boolean | null;
  source_updated_at: string | null;
};

export function toSupportFacility(row: FacilityRow): SupportFacility {
  const valid = row.coordinate_status === "valid" && row.latitude !== null && row.longitude !== null;
  return supportFacilitySchema.parse({
    cnes: row.cnes_code,
    name: row.official_name,
    officialType: { code: row.official_type_code, name: row.official_type_name },
    category: row.category,
    municipality: { code: row.municipality_code, name: row.municipality_name },
    state: row.state_code,
    address: {
      street: row.address_street,
      number: row.address_number,
      complement: row.address_complement,
      district: row.address_district,
      postalCode: row.postal_code,
    },
    phone: row.phone_display ? { display: row.phone_display, digits: row.phone_digits } : null,
    coordinates: valid ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : null,
    coordinateStatus: row.coordinate_status,
    sourceActive: row.source_active,
    sourceUpdatedAt: row.source_updated_at,
  });
}

export function toSupportProvenance(row: {
  source: string;
  is_fixture: boolean;
  source_reference_date: string;
  imported_at: string;
  activated_at: string | null;
  facility_count: number;
  age_days: number;
}): SupportProvenance {
  const source = row.source as SupportSource;
  return supportProvenanceSchema.parse({
    source,
    isFixture: row.is_fixture,
    referenceDate: row.source_reference_date,
    importedAt: row.imported_at,
    activatedAt: row.activated_at,
    facilityCount: row.facility_count,
    ageDays: row.age_days,
    freshness: supportFreshness(row.age_days),
    attribution: SUPPORT_ATTRIBUTION[source],
  });
}

export async function getSupportProvenance(client: Client): Promise<SupportProvenance | null> {
  const row = await readSupportProvenance(client);
  return row ? toSupportProvenance(row) : null;
}

export async function searchSupportNetwork(client: Client, raw: unknown): Promise<SupportSearchResult> {
  const query = supportSearchSchema.parse(raw);
  const [provenance, rows] = await Promise.all([getSupportProvenance(client), searchSupportFacilities(client, query)]);
  return { provenance, facilities: rows.map((row) => toSupportFacility(row as FacilityRow)) };
}

export async function getSupportFacility(client: Client, cnes: string): Promise<SupportFacility | null> {
  if (!/^[0-9]{7}$/.test(cnes)) return null;
  const row = await readSupportFacility(client, cnes);
  return row ? toSupportFacility(row as FacilityRow) : null;
}

export async function getSupportFacilityTypes(client: Client) {
  const rows = await listSupportFacilityTypes(client);
  return rows.map((row) => ({
    code: row.official_type_code,
    name: row.official_type_name,
    category: row.category,
    facilityCount: row.facility_count,
  }));
}

/* ---------------------------------------------------------------------------
   SUP-2 — navegacao por municipio. Nenhuma funcao aqui recebe coordenada.
   --------------------------------------------------------------------------- */

export async function getSupportMunicipalities(client: Client): Promise<SupportMunicipality[]> {
  const rows = await listSupportMunicipalities(client);
  return rows.map((row) => {
    const lat = row.approx_latitude === null ? null : Number(row.approx_latitude);
    const lng = row.approx_longitude === null ? null : Number(row.approx_longitude);
    return {
      code: row.municipality_code,
      name: row.municipality_name,
      state: row.state_code,
      facilityCount: row.facility_count,
      center: lat !== null && lng !== null && Number.isFinite(lat) && Number.isFinite(lng) ? { latitude: lat, longitude: lng } : null,
    };
  });
}

function toMunicipalityType(row: {
  official_type_code: string;
  official_type_name: string;
  category: string | null;
  facility_count: number;
}): SupportMunicipalityType {
  const category = supportCategorySchema.safeParse(row.category);
  return {
    code: row.official_type_code,
    name: row.official_type_name,
    category: category.success ? category.data : null,
    facilityCount: row.facility_count,
  };
}

/**
 * Uma pagina da lista + tipos do municipio + procedencia. Pede uma linha a
 * mais para saber se ha proxima pagina sem contar tudo.
 */
export async function browseSupportNetwork(client: Client, raw: unknown): Promise<SupportBrowseResult> {
  const request = supportBrowseSchema.parse(raw);
  const [provenance, rows, types] = await Promise.all([
    getSupportProvenance(client),
    searchSupportFacilities(client, {
      municipalityCode: request.municipalityCode,
      officialTypeCodes: request.officialTypeCode ? [request.officialTypeCode] : undefined,
      limit: SUPPORT_PAGE_SIZE + 1,
      offset: request.offset,
    }),
    listSupportMunicipalityTypes(client, request.municipalityCode),
  ]);
  return {
    provenance,
    facilities: rows.slice(0, SUPPORT_PAGE_SIZE).map((row) => toSupportFacility(row as FacilityRow)),
    types: types.map(toMunicipalityType),
    hasMore: rows.length > SUPPORT_PAGE_SIZE,
  };
}
