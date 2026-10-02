/**
 * SUP-2 — geometria no NAVEGADOR (ADR-0032).
 *
 * A coordenada da pessoa vive so na memoria da pagina: entra aqui, vira uma
 * distancia aproximada ou o municipio mais proximo, e nunca e enviada, gravada
 * nem posta na URL. Tudo que sai deste arquivo e derivado e grosseiro.
 */

export type LatLng = { latitude: number; longitude: number };

const EARTH_RADIUS_KM = 6371.0088;
const toRad = (degrees: number) => (degrees * Math.PI) / 180;

export function isValidLatLng(point: LatLng | null | undefined): point is LatLng {
  return (
    !!point &&
    Number.isFinite(point.latitude) &&
    Number.isFinite(point.longitude) &&
    Math.abs(point.latitude) <= 90 &&
    Math.abs(point.longitude) <= 180
  );
}

/** Haversine: distancia em linha reta sobre a esfera. Nao e rota. */
export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * "Aproximadamente X km" — linha reta, arredondada para nao sugerir precisao
 * de rota: < 1 km vira "menos de 1 km"; ate 10 km com uma casa; depois inteiro.
 */
export function formatApproxDistance(km: number): string {
  if (!Number.isFinite(km) || km < 0) return "";
  if (km < 1) return "Aproximadamente menos de 1 km";
  const value = km < 10 ? (Math.round(km * 10) / 10).toLocaleString("pt-BR") : Math.round(km).toLocaleString("pt-BR");
  return `Aproximadamente ${value} km`;
}

/**
 * Municipio cujo centro aproximado (media das unidades, 2 casas) esta mais
 * perto. Calculado aqui para o servidor nunca receber a posicao. `maxKm`
 * evita escolher um municipio distante quando a pessoa esta fora da cobertura.
 */
export function nearestByCenter<T extends { center: LatLng | null }>(
  origin: LatLng,
  items: readonly T[],
  maxKm = 60,
): { item: T; km: number } | null {
  let best: { item: T; km: number } | null = null;
  for (const item of items) {
    if (!isValidLatLng(item.center)) continue;
    const km = haversineKm(origin, item.center);
    if (!best || km < best.km) best = { item, km };
  }
  return best && best.km <= maxKm ? best : null;
}
