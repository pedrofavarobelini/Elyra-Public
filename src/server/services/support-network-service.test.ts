import { describe, expect, it } from "vitest";

import { toSupportFacility, toSupportProvenance } from "./support-network-service";

const row = {
  cnes_code: "9900001",
  official_name: "[DEMO] UBS Ficticia Alfa",
  official_type_code: "02",
  official_type_name: "CENTRO DE SAUDE/UNIDADE BASICA",
  category: null,
  municipality_code: "355030",
  municipality_name: "São Paulo",
  state_code: "SP",
  postal_code: "01000000",
  address_street: "Rua Ficticia",
  address_number: "100",
  address_complement: null,
  address_district: "Centro Demo",
  phone_display: "(11) 0000-0001",
  phone_digits: "1100000001",
  latitude: -23.55,
  longitude: -46.633,
  coordinate_status: "valid",
  source_active: true,
  source_updated_at: "2026-08-15",
};

describe("contrato SUP-1 -> SUP-2", () => {
  it("projecao vira SupportFacility sem campo interno", () => {
    const facility = toSupportFacility(row);
    expect(facility).toMatchObject({
      cnes: "9900001",
      officialType: { code: "02", name: "CENTRO DE SAUDE/UNIDADE BASICA" },
      category: null,
      coordinates: { latitude: -23.55, longitude: -46.633 },
      phone: { display: "(11) 0000-0001", digits: "1100000001" },
    });
    expect(Object.keys(facility)).not.toContain("snapshot_id");
    expect(JSON.stringify(facility)).not.toMatch(/sha|hash|snapshot/i);
  });

  it("coordenada invalida ou ausente nunca vira ponto", () => {
    expect(toSupportFacility({ ...row, coordinate_status: "invalid", latitude: null, longitude: null }).coordinates).toBeNull();
    expect(toSupportFacility({ ...row, phone_display: null, phone_digits: null }).phone).toBeNull();
  });

  it("procedencia carrega frescor e atribuicao; fixture nunca parece oficial", () => {
    const base = {
      source: "qa_fixture",
      is_fixture: true,
      source_reference_date: "2026-01-01",
      imported_at: "2026-09-27T00:00:00Z",
      activated_at: "2026-09-27T00:00:00Z",
      facility_count: 8,
      age_days: 120,
    };
    expect(toSupportProvenance(base)).toMatchObject({ freshness: "STALE", isFixture: true });
    expect(toSupportProvenance(base).attribution).toContain("fictícios");
    expect(toSupportProvenance({ ...base, source: "cnes_download", is_fixture: false, age_days: 10 })).toMatchObject({
      freshness: "CURRENT",
      attribution: expect.stringContaining("CNES/DATASUS"),
    });
  });
});
