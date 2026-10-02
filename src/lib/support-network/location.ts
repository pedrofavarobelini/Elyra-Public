/**
 * SUP-2 — estado da localizacao opt-in. So existe depois do toque em
 * "Usar minha localizacao"; nunca ao abrir a pagina, o SOS ou o mapa.
 *
 * `granted` guarda a coordenada SO em memoria (estado React). Nao ha
 * persistencia, log, analytics, URL nem envio: quem consome recebe a posicao
 * para calcular distancia/municipio no proprio navegador.
 */
import type { LatLng } from "./geo";

export type LocationState =
  | { status: "idle" }
  | { status: "requesting" }
  | { status: "granted"; position: LatLng; accuracyMeters: number | null }
  | { status: "denied" }
  | { status: "unavailable" }
  | { status: "timeout" };

export const LOCATION_REQUEST_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 15_000,
  maximumAge: 300_000,
};

/** `GeolocationPositionError.code`: 1 negado, 2 indisponivel, 3 tempo esgotado. */
export function locationStateFromError(code: number | undefined): LocationState {
  if (code === 1) return { status: "denied" };
  if (code === 3) return { status: "timeout" };
  return { status: "unavailable" };
}

export function locationStateFromPosition(coords: {
  latitude: number;
  longitude: number;
  accuracy?: number | null;
}): LocationState {
  const { latitude, longitude } = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    return { status: "unavailable" };
  }
  return {
    status: "granted",
    position: { latitude, longitude },
    accuracyMeters: Number.isFinite(coords.accuracy ?? NaN) ? (coords.accuracy as number) : null,
  };
}

/**
 * Pede UMA vez, por gesto. Sem `watchPosition`: nao segue a pessoa. Sem
 * geolocalizacao no navegador (ou bloqueada pela Permissions-Policy), cai em
 * `unavailable` sem erro.
 */
export function requestLocationOnce(
  geolocation: Geolocation | undefined,
  done: (state: LocationState) => void,
): void {
  if (!geolocation || typeof geolocation.getCurrentPosition !== "function") {
    done({ status: "unavailable" });
    return;
  }
  try {
    geolocation.getCurrentPosition(
      (position) => done(locationStateFromPosition(position.coords)),
      (error) => done(locationStateFromError(error?.code)),
      LOCATION_REQUEST_OPTIONS,
    );
  } catch {
    done({ status: "unavailable" });
  }
}
