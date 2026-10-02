/**
 * SUP-2 — provider de mapa (ADR-0032). UNICO lugar com URL de estilo/tiles.
 *
 * Camadas separadas de proposito:
 * - biblioteca: MapLibre GL JS (BSD-3), carregada so quando o mapa aparece;
 * - tiles/estilo: OpenFreeMap (instancia publica: sem chave, sem cookies,
 *   sem limite declarado, sem SLA; atribuicao obrigatoria);
 * - rota: deep link externo (`actions.ts`), sem motor proprio;
 * - geocoding: nenhum (municipio e coordenada vem do CNES).
 *
 * Trocar para PMTiles proprio ou outro provider e mudar ESTE objeto (e a CSP,
 * que le `connectOrigins` daqui). Nunca `tile.openstreetmap.org` (politica de
 * uso proibe uso pesado/offline) nem provider pago obrigatorio.
 */
export type SupportMapProvider = {
  id: string;
  styleUrl: string;
  /** Hosts que o navegador precisa alcançar (estilo, tiles, glifos, sprites). */
  connectOrigins: readonly string[];
  attribution: string;
  termsUrl: string;
  lastVerifiedAt: string;
};

export const SUPPORT_MAP_PROVIDER: SupportMapProvider = {
  id: "openfreemap",
  styleUrl: "https://tiles.openfreemap.org/styles/liberty",
  connectOrigins: ["https://tiles.openfreemap.org"],
  attribution: "OpenFreeMap © OpenMapTiles · Dados © colaboradores do OpenStreetMap",
  termsUrl: "https://openfreemap.org/",
  lastVerifiedAt: "2026-09-26",
};

/** Worker do MapLibre 6 servido da propria origem (`worker-src 'self'`). */
export function supportMapWorkerUrl(version: string): string {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+$/.test(version)) throw new Error("maplibre_version_invalid");
  return `/vendor/maplibre/${version}/maplibre-gl-worker.mjs`;
}
