"use client";

import { MapPinOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SUPPORT_COPY } from "@/lib/support-network/copy";
import { SUPPORT_MAP_PROVIDER } from "@/lib/support-network/map-provider";

import type { SupportMapHandle, SupportMapPoint } from "./maplibre-adapter";

type MapStatus = "idle" | "loading" | "ready" | "failed";

function hasWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") ?? canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

/**
 * Mapa complementar (SUP-2). So carrega a biblioteca quando `active` (aba Mapa
 * aberta ou tela larga com resultado). Sem WebGL, com estilo/tiles/worker
 * falhando, ou com erro de JS no adapter: aviso curto e a lista segue sendo o
 * caminho completo. O resumo textual diz quantas unidades estao no mapa.
 */
export function SupportMap({
  points,
  totalInList,
  summaryText,
  selectedCnes,
  onSelect,
  active,
}: {
  points: SupportMapPoint[];
  totalInList: number;
  /** Resumo proprio (ex.: visao geral por municipio); padrao = contagem de unidades. */
  summaryText?: string;
  selectedCnes: string | null;
  onSelect: (cnes: string) => void;
  active: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const handleRef = useRef<SupportMapHandle | null>(null);
  const onSelectRef = useRef(onSelect);
  const [status, setStatus] = useState<MapStatus>("idle");

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  const startedRef = useRef(false);
  const unmountedRef = useRef(false);


  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, [],
  );

  /*
    Inicia UMA vez, quando o mapa fica visivel. O efeito depende so de
    `active`: mudar o proprio status (idle -> loading) nao pode cancelar a
    carga em andamento (foi o bug do primeiro E2E: o mapa ficava em
    "loading" para sempre).
  */
  useEffect(() => {
    if (!active || startedRef.current || !containerRef.current) return;
    startedRef.current = true;
    const container = containerRef.current;
    const cancelled = () => unmountedRef.current;
    // Assincrono de proposito: o estado muda na resolucao, nao no corpo do efeito.
    void Promise.resolve()
      .then(() => {
        if (!hasWebGL()) throw new Error("webgl_unavailable");
        if (!cancelled()) setStatus("loading");
        return import("./maplibre-adapter");
      })
      .then(({ createSupportMap }) => {
        if (cancelled()) return;
        handleRef.current = createSupportMap(container, {
          onSelect: (cnes) => onSelectRef.current(cnes),
          onError: () => {
            if (!cancelled()) setStatus("failed");
          },
          onReady: () => {
            if (!cancelled()) setStatus("ready");
          },
        });
      })
      .catch(() => {
        if (!cancelled()) setStatus("failed");
      });
  }, [active]);

  useEffect(() => () => handleRef.current?.destroy(), []);

  useEffect(() => {
    if (status === "failed") {
      handleRef.current?.destroy();
      handleRef.current = null;
    }
  }, [status]);

  useEffect(() => {
    if (status === "ready") handleRef.current?.setPoints(points);
  }, [status, points]);

  useEffect(() => {
    if (status === "ready") handleRef.current?.select(selectedCnes);
  }, [status, selectedCnes]);

  const summary =
    summaryText ??
    (points.length === totalInList
      ? `${points.length} ${points.length === 1 ? "unidade aparece" : "unidades aparecem"} no mapa. A lista tem as mesmas.`
      : `${points.length} de ${totalInList} unidades desta lista aparecem no mapa; as demais não têm localização válida na fonte. A lista tem todas.`);

  return (
    <section
      aria-label={SUPPORT_COPY.mapRegion}
      data-testid="support-map"
      data-map-status={status}
      className="flex min-h-0 flex-col gap-2"
    >
      <p className="text-xs text-ink-muted" data-testid="support-map-summary">
        {summary}
      </p>
      {status === "failed" ? (
        <div
          role="status"
          data-testid="support-map-failed"
          className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 rounded-panel border border-dashed border-line bg-surface-muted p-6 text-center text-sm text-ink-muted"
        >
          <MapPinOff className="size-6" aria-hidden="true" />
          {SUPPORT_COPY.mapUnavailable}
        </div>
      ) : (
        <div className="relative min-h-80 flex-1 overflow-hidden rounded-panel border border-line bg-surface-muted xl:min-h-[32rem]">
          {/* O canvas e decorativo para leitor de tela: os pinos sao botoes com nome e a lista e o caminho completo. */}
          {/*
            Posicao INLINE de proposito: o CSS do MapLibre (carregado depois)
            poe `.maplibregl-map { position: relative }` e vencia a classe
            `absolute` — o container ficava com 0 px de altura, o canvas no
            padrao de 300 px e os pinos recortados (achado 27/09, pino sem clique).
          */}
          <div ref={containerRef} style={{ position: "absolute", inset: 0 }} />
          {status !== "ready" ? (
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-muted">
              {status === "loading" ? "Carregando mapa…" : "O mapa aparece aqui."}
            </p>
          ) : null}
        </div>
      )}
      <p className="text-[0.7rem] text-ink-subtle">
        Mapa:{" "}
        <a href={SUPPORT_MAP_PROVIDER.termsUrl} target="_blank" rel="noopener noreferrer" className="underline-offset-2 hover:underline">
          {SUPPORT_MAP_PROVIDER.attribution}
          <span className="sr-only"> (abre em nova aba)</span>
        </a>
      </p>
    </section>
  );
}
