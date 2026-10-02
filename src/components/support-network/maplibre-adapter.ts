/**
 * SUP-2 — adapter do mapa (ADR-0032). SO este arquivo conhece o MapLibre; a
 * tela fala com a interface `SupportMapHandle`. Carregado por `import()`
 * dinamico quando o mapa aparece: a lista nunca espera por ele.
 *
 * Regras:
 * - pinos = unidades da lista atual (nada alem disso), como <button> com nome;
 * - enquadramento pelas UNIDADES, nunca pela posicao da pessoa (o provider de
 *   tiles ve a area pedida; a Elyra nao aproxima o mapa de onde a pessoa esta);
 * - movimento reduzido (sistema ou preferencia interna) desliga animacao de camera;
 * - qualquer falha (WebGL, estilo, tiles, worker) vira `onError`, e a lista segue.
 */
import "maplibre-gl/dist/maplibre-gl.css";

import * as maplibregl from "maplibre-gl";

import { SUPPORT_MAP_PROVIDER, supportMapWorkerUrl } from "@/lib/support-network/map-provider";
import { isReducedMotion } from "@/lib/motion";

export type SupportMapPoint = { cnes: string; name: string; latitude: number; longitude: number };

export type SupportMapHandle = {
  setPoints(points: SupportMapPoint[]): void;
  select(cnes: string | null): void;
  destroy(): void;
};

let workerConfigured = false;

// Sistema OU preferencia interna da Elyra (MOTION-GAP-01): camera sem voo.
const reducedMotion = isReducedMotion;

export function createSupportMap(
  container: HTMLElement,
  options: { onSelect: (cnes: string) => void; onError: () => void; onReady: () => void },
): SupportMapHandle {
  if (!workerConfigured) {
    maplibregl.setWorkerUrl(supportMapWorkerUrl(maplibregl.getVersion()));
    workerConfigured = true;
  }

  let failed = false;
  const fail = () => {
    if (failed) return;
    failed = true;
    options.onError();
  };

  const map = new maplibregl.Map({
    container,
    style: SUPPORT_MAP_PROVIDER.styleUrl,
    center: [-47.9, -15.8],
    zoom: 3,
    attributionControl: { compact: false, customAttribution: SUPPORT_MAP_PROVIDER.attribution },
    // Rolar a pagina sobre o mapa nao da zoom sem querer (celular e trackpad).
    cooperativeGestures: true,
    maxZoom: 18,
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");

  /*
    Erro ANTES do primeiro "load" (estilo, worker, WebGL, host bloqueado) ou
    demora acima de 15 s: o mapa sai de cena, a lista nao. Depois do "load",
    um tile isolado que falha nao derruba o mapa inteiro.
  */
  let loaded = false;
  const timeout = window.setTimeout(() => {
    if (!loaded) fail();
  }, 15_000);
  map.on("error", () => {
    if (!loaded) fail();
  });
  map.once("load", () => {
    loaded = true;
    window.clearTimeout(timeout);
    if (!failed) options.onReady();
  });
  // WebGL perdido = mapa inutilizavel.
  map.getCanvas().addEventListener("webglcontextlost", fail, { once: true });

  const markers = new Map<string, { marker: maplibregl.Marker; element: HTMLButtonElement }>();
  let selected: string | null = null;
  let framed: maplibregl.LngLatBounds | null = null;

  /*
    O container pode mudar de tamanho depois de o mapa nascer (visao geral na
    entrada: fonte e grade ainda assentando). O MapLibre so acompanha resize da
    janela; sem isto o canvas fica com o tamanho antigo e os pinos caem fora da
    area visivel. Redimensiona e reenquadra os pontos atuais, sem animacao.
  */
  const resizeObserver =
    typeof ResizeObserver === "function"
      ? new ResizeObserver(() => {
          map.resize();
          if (framed) map.fitBounds(framed, { padding: 48, maxZoom: 15, animate: false });
        })
      : null;
  resizeObserver?.observe(container);

  const paint = () => {
    for (const [cnes, { element }] of markers) {
      const on = cnes === selected;
      element.dataset.selected = on ? "true" : "false";
      element.setAttribute("aria-pressed", on ? "true" : "false");
    }
  };

  return {
    setPoints(points) {
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      const bounds = new maplibregl.LngLatBounds();
      for (const point of points) {
        const element = document.createElement("button");
        element.type = "button";
        element.className = "elyra-support-pin";
        element.dataset.cnes = point.cnes;
        // Nome visivel ao leitor de tela; o texto vem da fonte, entao so textContent/atributo (nunca HTML).
        element.setAttribute("aria-label", `${point.name} (no mapa)`);
        element.title = point.name;
        element.addEventListener("click", (event) => {
          event.stopPropagation();
          options.onSelect(point.cnes);
        });
        const marker = new maplibregl.Marker({ element, anchor: "bottom" })
          .setLngLat([point.longitude, point.latitude])
          .addTo(map);
        markers.set(point.cnes, { marker, element });
        bounds.extend([point.longitude, point.latitude]);
      }
      paint();
      framed = bounds.isEmpty() ? null : bounds;
      if (framed) {
        map.fitBounds(framed, { padding: 48, maxZoom: 15, animate: !reducedMotion() });
      }
    },
    select(cnes) {
      selected = cnes;
      paint();
      const target = cnes ? markers.get(cnes) : null;
      if (target) {
        map.easeTo({ center: target.marker.getLngLat(), duration: reducedMotion() ? 0 : 300 });
      }
    },
    destroy() {
      resizeObserver?.disconnect();
      window.clearTimeout(timeout);
      for (const { marker } of markers.values()) marker.remove();
      markers.clear();
      map.remove();
    },
  };
}
