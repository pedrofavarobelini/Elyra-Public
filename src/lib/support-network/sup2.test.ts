import { describe, expect, it, vi } from "vitest";

import { supportBrowseSchema, type SupportFacility, type SupportProvenance } from "@/lib/contracts/support-network";

import { supportAddressLine, supportRouteUrl, supportTelHref } from "./actions";
import { SUPPORT_COPY, supportFreshnessCopy, supportReferenceLabel, supportSourceLabel } from "./copy";
import { formatApproxDistance, haversineKm, nearestByCenter } from "./geo";
import { locationStateFromError, locationStateFromPosition, requestLocationOnce } from "./location";
import { SUPPORT_MAP_PROVIDER, supportMapWorkerUrl } from "./map-provider";
import {
  SUPPORT_CACHE_POLICY,
  createMemorySupportBackend,
  createSupportCache,
  isSupportCacheFresh,
  supportCacheKey,
} from "./offline-cache";

const facility: SupportFacility = {
  cnes: "9900001",
  name: "[DEMO] UBS Ficticia Alfa",
  officialType: { code: "02", name: "CENTRO DE SAUDE/UNIDADE BASICA" },
  category: null,
  municipality: { code: "355030", name: "São Paulo" },
  state: "SP",
  address: { street: "Rua Ficticia", number: "100", complement: null, district: "Centro Demo", postalCode: "01000000" },
  phone: { display: "(11) 0000-0001", digits: "1100000001" },
  coordinates: { latitude: -23.55, longitude: -46.633 },
  coordinateStatus: "valid",
  sourceActive: true,
  sourceUpdatedAt: "2026-08-15",
};

const provenance = (overrides: Partial<SupportProvenance> = {}): SupportProvenance => ({
  source: "qa_fixture",
  isFixture: true,
  referenceDate: "2026-09-01",
  importedAt: "2026-09-26T10:00:00Z",
  activatedAt: "2026-09-26T10:00:00Z",
  facilityCount: 8,
  ageDays: 25,
  freshness: "CURRENT",
  attribution: "x",
  ...overrides,
});

describe("distancia (so no navegador)", () => {
  it("haversine conhecido: Se (SP) -> Cristo (RJ) ~ 361 km em linha reta", () => {
    const km = haversineKm({ latitude: -23.5503, longitude: -46.6339 }, { latitude: -22.9519, longitude: -43.2105 });
    expect(km).toBeGreaterThan(355);
    expect(km).toBeLessThan(365);
    expect(haversineKm({ latitude: 1, longitude: 1 }, { latitude: 1, longitude: 1 })).toBe(0);
  });

  it("formata como aproximada, sem precisao de rota", () => {
    expect(formatApproxDistance(0.4)).toBe("Aproximadamente menos de 1 km");
    expect(formatApproxDistance(3.46)).toBe("Aproximadamente 3,5 km");
    expect(formatApproxDistance(27.6)).toBe("Aproximadamente 28 km");
    expect(formatApproxDistance(Number.NaN)).toBe("");
  });

  it("municipio mais proximo por centro aproximado; fora da cobertura = nenhum", () => {
    const items = [
      { code: "355030", center: { latitude: -23.55, longitude: -46.64 } },
      { code: "330455", center: { latitude: -22.91, longitude: -43.17 } },
      { code: "000000", center: null },
    ];
    expect(nearestByCenter({ latitude: -23.6, longitude: -46.7 }, items)?.item.code).toBe("355030");
    expect(nearestByCenter({ latitude: -3.1, longitude: -60.0 }, items)).toBeNull();
  });
});

describe("estado da localizacao (opt-in)", () => {
  it("codigos do navegador viram estados sem culpa", () => {
    expect(locationStateFromError(1)).toEqual({ status: "denied" });
    expect(locationStateFromError(2)).toEqual({ status: "unavailable" });
    expect(locationStateFromError(3)).toEqual({ status: "timeout" });
    expect(locationStateFromError(undefined)).toEqual({ status: "unavailable" });
  });

  it("coordenada absurda nao vira 'granted'", () => {
    expect(locationStateFromPosition({ latitude: 91, longitude: 0 })).toEqual({ status: "unavailable" });
    expect(locationStateFromPosition({ latitude: -23.5, longitude: -46.6, accuracy: 30 })).toMatchObject({
      status: "granted",
      accuracyMeters: 30,
    });
  });

  it("pede uma vez (getCurrentPosition), nunca segue (watchPosition); GPS negado vira 'denied'", () => {
    const geolocation = {
      getCurrentPosition: vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) =>
        fail({ code: 1 } as GeolocationPositionError),
      ),
      watchPosition: vi.fn(),
      clearWatch: vi.fn(),
    } as unknown as Geolocation;
    const done = vi.fn();
    requestLocationOnce(geolocation, done);
    expect(done).toHaveBeenCalledWith({ status: "denied" });
    expect(geolocation.watchPosition).not.toHaveBeenCalled();
  });

  it("sem API de geolocalizacao (ou bloqueada): 'unavailable' sem erro", () => {
    const done = vi.fn();
    requestLocationOnce(undefined, done);
    expect(done).toHaveBeenCalledWith({ status: "unavailable" });
  });
});

describe("busca: validacao do pedido", () => {
  it("aceita municipio 6/7 digitos, tipo e pagina", () => {
    expect(supportBrowseSchema.parse({ municipalityCode: "3550308", officialTypeCode: "02" })).toEqual({
      municipalityCode: "3550308",
      officialTypeCode: "02",
      offset: 0,
    });
  });

  it.each([
    [{ municipalityCode: "35" }],
    [{ municipalityCode: "355030'; drop table x;--" }],
    [{ municipalityCode: "355030", officialTypeCode: "<script>" }],
    [{ municipalityCode: "355030", offset: -1 }],
    // Coordenada da pessoa nunca faz parte do pedido: campo extra e recusado.
    [{ municipalityCode: "355030", latitude: -23.5, longitude: -46.6 }],
  ])("recusa %j", (body) => {
    expect(supportBrowseSchema.safeParse(body).success).toBe(false);
  });
});

describe("acoes da unidade", () => {
  it("tel: so com digitos; qualquer outra coisa some", () => {
    expect(supportTelHref(facility.phone)).toBe("tel:1100000001");
    expect(supportTelHref(null)).toBeNull();
    expect(supportTelHref({ display: "x", digits: null })).toBeNull();
    expect(supportTelHref({ display: "x", digits: "javascript:alert(1)" })).toBeNull();
    expect(supportTelHref({ display: "x", digits: "123" })).toBeNull();
    expect(supportTelHref({ display: "x", digits: "11999998888;ext=1" })).toBeNull();
  });

  it("rota: destino = unidade (numeros), nunca origem da pessoa", () => {
    const url = new URL(supportRouteUrl(facility)!);
    expect(url.origin).toBe("https://www.google.com");
    expect(url.searchParams.get("destination")).toBe("-23.550000,-46.633000");
    expect(url.searchParams.has("origin")).toBe(false);
  });

  it("rota sem coordenada usa o endereco codificado; sem endereco, sem rota", () => {
    const noCoords = { ...facility, coordinates: null, coordinateStatus: "missing" as const, name: "<img onerror=x>" };
    const url = new URL(supportRouteUrl(noCoords)!);
    expect(url.searchParams.get("destination")).toContain("Rua Ficticia");
    expect(url.toString()).not.toContain("<");
    expect(supportRouteUrl({ ...noCoords, address: { ...noCoords.address, street: null } })).toBeNull();
  });

  it("endereco em uma linha so com o que existe", () => {
    expect(supportAddressLine(facility)).toBe("Rua Ficticia, 100 · Centro Demo · São Paulo / SP");
  });
});

describe("procedencia, frescor e demo", () => {
  it("frescor em linguagem de produto; envelhecer nao e fechar", () => {
    expect(supportFreshnessCopy("CURRENT", "09/2026")).toMatch(/atualizados/);
    expect(supportFreshnessCopy("AGING", "06/2026")).toBe("Informação de 06/2026");
    expect(supportFreshnessCopy("STALE", "01/2026")).toMatch(/pode estar desatualizada/);
    for (const freshness of ["CURRENT", "AGING", "STALE"] as const) {
      expect(supportFreshnessCopy(freshness, "01/2026")).not.toMatch(/fechad|encerrad|inativ/i);
    }
    expect(supportReferenceLabel("2026-08-01")).toBe("08/2026");
  });

  it("fixture sempre anunciada como demonstracao; fonte oficial nunca", () => {
    expect(supportSourceLabel(provenance())).toMatch(/demonstração/);
    expect(supportSourceLabel(provenance({ source: "cnes_download", isFixture: false }))).toMatch(/CNES/);
    expect(SUPPORT_COPY.demoBanner).toBe("Ambiente de demonstração — unidades fictícias.");
  });

  it("nenhum texto promete atendimento, vaga ou escolhe pela pessoa", () => {
    const all = Object.values(SUPPORT_COPY)
      .map((value) => (typeof value === "function" ? value("01/01") : value))
      .join(" ");
    expect(all).not.toMatch(/mais indicad|melhor|aberto agora|tem vaga|garantid|não existem serviços/i);
  });
});

describe("cache offline (READ_ONLY_OFFLINE)", () => {
  const entry = (code: string) => ({
    municipalityCode: code,
    municipalityLabel: `M ${code}`,
    officialTypeCode: null,
    provenance: provenance(),
    facilities: [facility],
    types: [],
  });

  it("chave = municipio + filtro; nunca coordenada", () => {
    expect(supportCacheKey("3550308", null)).toBe("355030|*");
    expect(supportCacheKey("355030", "02")).toBe("355030|02");
    expect(() => supportCacheKey("-23.55,-46.6", null)).toThrow();
  });

  it("TTL de 30 dias", () => {
    const now = Date.UTC(2026, 8, 26);
    expect(isSupportCacheFresh({ cachedAt: now - 29 * 86_400_000 }, now)).toBe(true);
    expect(isSupportCacheFresh({ cachedAt: now - 31 * 86_400_000 }, now)).toBe(false);
    expect(SUPPORT_CACHE_POLICY).toEqual({ ttlDays: 30, maxEntries: 3 });
  });

  it("guarda, le, expira e mantem so as 3 mais recentes", async () => {
    const cache = createSupportCache(createMemorySupportBackend());
    const t0 = Date.UTC(2026, 8, 1);
    await cache.save(entry("111111"), t0);
    await cache.save(entry("222222"), t0 + 1000);
    await cache.save(entry("333333"), t0 + 2000);
    await cache.save(entry("444444"), t0 + 3000);
    const recent = await cache.recent(t0 + 4000);
    expect(recent.map((item) => item.municipalityCode)).toEqual(["444444", "333333", "222222"]);
    expect((await cache.load("444444", null, t0 + 4000))?.facilities).toHaveLength(1);
    expect(await cache.load("444444", null, t0 + 31 * 86_400_000)).toBeNull();
    expect(JSON.stringify(recent)).not.toMatch(/latitude":-23\.6|position|accuracy/);
  });

  it("falha do armazenamento nunca derruba a lista", async () => {
    const broken = createSupportCache({
      all: () => Promise.reject(new Error("quota")),
      put: () => Promise.reject(new Error("quota")),
      remove: () => Promise.reject(new Error("quota")),
      clear: () => Promise.reject(new Error("quota")),
    });
    await expect(broken.save(entry("111111"))).resolves.toBeUndefined();
    await expect(broken.load("111111", null)).resolves.toBeNull();
  });
});

describe("provider do mapa", () => {
  it("config central: estilo HTTPS no host declarado, atribuicao e termos", () => {
    const style = new URL(SUPPORT_MAP_PROVIDER.styleUrl);
    expect(style.protocol).toBe("https:");
    expect(SUPPORT_MAP_PROVIDER.connectOrigins).toContain(style.origin);
    expect(SUPPORT_MAP_PROVIDER.attribution).toMatch(/OpenStreetMap/);
    expect(SUPPORT_MAP_PROVIDER.lastVerifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(SUPPORT_MAP_PROVIDER.styleUrl).not.toContain("tile.openstreetmap.org");
  });

  it("worker da propria origem com versao no caminho", () => {
    expect(supportMapWorkerUrl("6.11.2")).toBe("/vendor/maplibre/6.11.2/maplibre-gl-worker.mjs");
    expect(() => supportMapWorkerUrl("../../x")).toThrow();
  });
});
