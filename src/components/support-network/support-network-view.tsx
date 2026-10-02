"use client";

import { Building2, CloudOff, FlaskConical, LocateFixed, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { EmptyState, ErrorState, InlineLoading } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  SupportBrowseResult,
  SupportFacility,
  SupportMunicipality,
  SupportMunicipalityType,
  SupportProvenance,
} from "@/lib/contracts/support-network";
import {
  SUPPORT_COPY,
  supportFreshnessCopy,
  supportReferenceLabel,
  supportSourceLabel,
} from "@/lib/support-network/copy";
import { formatApproxDistance, haversineKm, nearestByCenter } from "@/lib/support-network/geo";
import { requestLocationOnce, type LocationState } from "@/lib/support-network/location";
import { createSupportCache } from "@/lib/support-network/offline-cache";
import { cn } from "@/lib/utils";

import { FacilityCard, FacilityDetailDialog } from "./facility-card";
import { groupByState, plural, UF_NAMES } from "./support-catalog";
import { SupportMap } from "./support-map";

type Status = "idle" | "loading" | "ready" | "error" | "offline";
type View = "list" | "map";

const WIDE_QUERY = "(min-width: 80rem)";

const OVERVIEW_WIDE_QUERY = "(min-width: 64rem)";

function useWide(query: string = WIDE_QUERY): boolean {
  return useSyncExternalStore(
    (notify) => {
      if (typeof window.matchMedia !== "function") return () => {};
      const media = window.matchMedia(query);
      media.addEventListener("change", notify);
      return () => media.removeEventListener("change", notify);
    },
    () => typeof window.matchMedia === "function" && window.matchMedia(query).matches,
    () => false,
  );
}

const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function municipalityLabel(item: Pick<SupportMunicipality, "name" | "state" | "code">): string {
  return `${item.name ?? `Município ${item.code}`} — ${item.state}`;
}

function formatSavedAt(timestamp: number) {
  return new Date(timestamp).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Rede de Apoio (SUP-2, ADR-0032) — lista primeiro, mapa complementar.
 *
 * Nunca: pedir localizacao ao abrir, mandar coordenada ao servidor, escolher a
 * unidade pela pessoa, prometer atendimento. A lista funciona sem mapa, sem
 * GPS e sem rede (ultima lista salva).
 */
export function SupportNetworkView({
  initialProvenance,
  municipalities,
}: {
  initialProvenance: SupportProvenance | null;
  /** `null` = falha ao carregar o catalogo (erro honesto, nao lista vazia). */
  municipalities: SupportMunicipality[] | null;
}) {
  const wide = useWide();
  const overviewWide = useWide(OVERVIEW_WIDE_QUERY);
  const cache = useMemo(() => createSupportCache(), []);
  const inputId = useId();
  const suggestionsId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const requestSeq = useRef(0);

  const [query, setQuery] = useState("");
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [municipality, setMunicipality] = useState<SupportMunicipality | null>(null);
  // Codigo curto da falha (status HTTP, "rede" ou "resposta") para o QA diagnosticar sem abrir o DevTools.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [typeCode, setTypeCode] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [provenance, setProvenance] = useState<SupportProvenance | null>(initialProvenance);
  const [facilities, setFacilities] = useState<SupportFacility[]>([]);
  const [types, setTypes] = useState<SupportMunicipalityType[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [location, setLocation] = useState<LocationState>({ status: "idle" });
  const [locationNote, setLocationNote] = useState<string | null>(null);
  const [selectedCnes, setSelectedCnes] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportFacility | null>(null);
  const [view, setView] = useState<View>("list");
  const [announcement, setAnnouncement] = useState("");

  const demo = provenance?.isFixture ?? false;
  const offline = status === "offline";

  const suggestions = useMemo(() => {
    if (!municipalities) return [];
    const needle = fold(query);
    if (!needle) return municipalities.slice(0, 8);
    return municipalities
      .filter((item) => fold(municipalityLabel(item)).includes(needle))
      .slice(0, 8);
  }, [municipalities, query]);

  const search = useCallback(
    async (target: SupportMunicipality, nextType: string | null, offset = 0) => {
      const seq = ++requestSeq.current;
      setStatus("loading");
      if (offset === 0) setSelectedCnes(null);
      const label = municipalityLabel(target);
      try {
        const response = await fetch("/api/support/facilities/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ municipalityCode: target.code, officialTypeCode: nextType ?? undefined, offset }),
          cache: "no-store",
        });
        if (!response.ok) {
          setErrorCode(String(response.status));
          throw new Error(`http_${response.status}`);
        }
        const { data } = (await response.json()) as { data: SupportBrowseResult };
        if (seq !== requestSeq.current) return;
        const list = offset === 0 ? data.facilities : [...facilities, ...data.facilities];
        setProvenance(data.provenance);
        setFacilities(list);
        setTypes(data.types);
        setHasMore(data.hasMore);
        setSavedAt(null);
        setStatus("ready");
        setAnnouncement(
          list.length === 0
            ? `${SUPPORT_COPY.empty} ${label}.`
            : `${list.length} ${list.length === 1 ? "serviço encontrado" : "serviços encontrados"} em ${label}.`,
        );
        void cache.save({
          municipalityCode: target.code,
          municipalityLabel: label,
          officialTypeCode: nextType,
          provenance: data.provenance,
          facilities: list,
          types: data.types,
        });
      } catch (error) {
        if (seq !== requestSeq.current) return;
        const network = error instanceof TypeError || (typeof navigator !== "undefined" && navigator.onLine === false);
        const saved = network ? await cache.load(target.code, nextType) : null;
        if (saved) {
          setProvenance(saved.provenance);
          setFacilities(saved.facilities);
          setTypes(saved.types);
          setHasMore(false);
          setSavedAt(saved.cachedAt);
          setStatus("offline");
          setAnnouncement(SUPPORT_COPY.offline(formatSavedAt(saved.cachedAt)));
          return;
        }
        if (!(error instanceof Error && error.message.startsWith("http_"))) setErrorCode(error instanceof TypeError ? "rede" : "resposta");
        // Busca nova que falhou: a lista do municipio anterior nunca fica na tela
        // como se fosse deste (OFF-5). Em "carregar mais", a lista ja e deste municipio.
        if (offset === 0) {
          setFacilities([]);
          setProvenance(null);
          setHasMore(false);
        }
        setStatus("error");
        setAnnouncement(SUPPORT_COPY.error);
      }
    },
    [cache, facilities],
  );

  const choose = (item: SupportMunicipality) => {
    setMunicipality(item);
    setQuery(municipalityLabel(item));
    setSuggestionsOpen(false);
    setTypeCode(null);
    setLocationNote(null);
    void search(item, null);
  };

  const chooseType = (code: string | null) => {
    setTypeCode(code);
    if (municipality) void search(municipality, code);
  };

  const useMyLocation = () => {
    setLocation({ status: "requesting" });
    setLocationNote(null);
    requestLocationOnce(typeof navigator === "undefined" ? undefined : navigator.geolocation, (next) => {
      setLocation(next);
      if (next.status !== "granted" || !municipalities) return;
      // Municipio mais proximo calculado AQUI; o servidor so recebe o codigo.
      const nearest = nearestByCenter(next.position, municipalities);
      if (!nearest) {
        setLocationNote(SUPPORT_COPY.locationOutside);
        return;
      }
      if (!municipality || municipality.code !== nearest.item.code) {
        setMunicipality(nearest.item);
        setQuery(municipalityLabel(nearest.item));
        setTypeCode(null);
        void search(nearest.item, null);
      }
      setLocationNote(`Mostrando ${municipalityLabel(nearest.item)}, o município com dados mais perto de você.`);
    });
  };

  // Distancia so no navegador; ordem por distancia quando ha localizacao.
  const origin = location.status === "granted" ? location.position : null;
  const rows = useMemo(() => {
    const withDistance = facilities.map((facility) => ({
      facility,
      km: origin && facility.coordinates ? haversineKm(origin, facility.coordinates) : null,
    }));
    if (!origin) return withDistance;
    return [...withDistance].sort((a, b) => {
      if (a.km === null && b.km === null) return a.facility.name.localeCompare(b.facility.name, "pt-BR");
      if (a.km === null) return 1;
      if (b.km === null) return -1;
      return a.km - b.km;
    });
  }, [facilities, origin]);

  const points = useMemo(
    () =>
      facilities
        .filter((facility) => facility.coordinates && facility.coordinateStatus === "valid")
        .map((facility) => ({
          cnes: facility.cnes,
          name: facility.name,
          latitude: facility.coordinates!.latitude,
          longitude: facility.coordinates!.longitude,
        })),
    [facilities],
  );

  // Catalogo (entrada): ESTADO -> MUNICIPIO, com filtro de texto e de UF. Os pinos
  // sao os municipios filtrados que tem centro aproximado (o mapa segue a lista).
  const [catalogText, setCatalogText] = useState("");
  const [catalogState, setCatalogState] = useState("");
  const [openStates, setOpenStates] = useState<Set<string> | null>(null);
  const catalogGroups = useMemo(
    () => groupByState(municipalities ?? [], { text: catalogText, state: catalogState || undefined }),
    [municipalities, catalogText, catalogState],
  );
  const catalogStates = useMemo(
    () => [...new Set((municipalities ?? []).map((item) => item.state))].sort((a, b) => (UF_NAMES[a] ?? a).localeCompare(UF_NAMES[b] ?? b, "pt-BR")),
    [municipalities],
  );
  // Poucos estados (demo) ou filtro ativo: grupos abertos. Nacional: fechados ate a pessoa abrir.
  const filtering = catalogText.trim() !== "" || catalogState !== "";
  const isStateOpen = (state: string) => (openStates ? openStates.has(state) : filtering || catalogGroups.length <= 5);
  const toggleState = (state: string, open: boolean) =>
    setOpenStates((current) => {
      const next = new Set(current ?? catalogGroups.filter((group) => isStateOpen(group.state)).map((group) => group.state));
      if (open) next.add(state);
      else next.delete(state);
      return next;
    });
  const overviewMunicipalities = useMemo(
    () => catalogGroups.flatMap((group) => group.municipalities).filter((item) => item.center).slice(0, 300),
    [catalogGroups],
  );
  const overviewPoints = useMemo(
    () =>
      overviewMunicipalities.map((item) => ({
        cnes: `municipio:${item.code}`,
        name: `${municipalityLabel(item)} — ${item.facilityCount} ${item.facilityCount === 1 ? "unidade" : "unidades"}`,
        latitude: item.center!.latitude,
        longitude: item.center!.longitude,
      })),
    [overviewMunicipalities],
  );

  // Pino de municipio na visao geral = escolher o municipio (mesmo caminho da busca).
  const selectMunicipalityFromMap = (id: string) => {
    const item = (municipalities ?? []).find((entry) => `municipio:${entry.code}` === id);
    if (item) choose(item);
  };

  const selectFromMap = useCallback(
    (cnes: string) => {
      setSelectedCnes(cnes);
      if (!wide) setView("list");
      // Depois da troca de aba: rola ate o item e poe o foco no nome.
      window.setTimeout(() => {
        const target = itemRefs.current.get(cnes);
        target?.scrollIntoView({ block: "nearest" });
        target?.focus();
      }, 0);
    },
    [wide],
  );

  const showOnMap = (cnes: string) => {
    setSelectedCnes(cnes);
    if (!wide) setView("map");
  };

  // Com a rede de volta, a lista salva e trocada pela atual (sem novo toque).
  useEffect(() => {
    if (status !== "offline" || !municipality) return;
    const onOnline = () => void search(municipality, typeCode);
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [status, municipality, typeCode, search]);

  const distanceOf = (cnes: string) => {
    const row = rows.find((item) => item.facility.cnes === cnes);
    return row?.km != null ? formatApproxDistance(row.km) : null;
  };

  const listPanel = (
    <div className={cn("flex min-w-0 flex-col gap-3", view === "map" && !wide && "hidden")} data-testid="support-list-panel">
      {status === "loading" && facilities.length === 0 ? (
        <InlineLoading>Buscando serviços…</InlineLoading>
      ) : null}
      {status === "error" ? (
        <div className="flex flex-col gap-3">
          <ErrorState description={`${SUPPORT_COPY.error}${errorCode ? ` (código: ${errorCode})` : ""}`} onRetry={() => municipality && void search(municipality, typeCode)} />
<SosPointer />
        </div>
      ) : null}
      {(status === "ready" || status === "offline") && facilities.length === 0 ? (
        <div className="flex flex-col gap-3" data-testid="support-empty">
          <EmptyState
            icon={<Building2 />}
            title={SUPPORT_COPY.empty}
            description={SUPPORT_COPY.emptyHint}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                {typeCode ? (
                  <Button type="button" variant="secondary" size="sm" onClick={() => chooseType(null)}>
                    Remover filtro
                  </Button>
                ) : null}
                <Button type="button" variant="secondary" size="sm" onClick={() => inputRef.current?.focus()}>
                  Alterar município
                </Button>
              </div>
            }
          />
<SosPointer />
        </div>
      ) : null}
      {facilities.length > 0 ? (
        <>
          <ul className="flex flex-col gap-3 xl:max-h-[40rem] xl:overflow-y-auto xl:pr-1" aria-label="Serviços encontrados" data-testid="support-list">
            {rows.map(({ facility, km }) => (
              <li key={facility.cnes}>
                <FacilityCard
                  facility={facility}
                  distance={km !== null ? formatApproxDistance(km) : null}
                  demo={demo}
                  offline={offline}
                  selected={selectedCnes === facility.cnes}
                  onShowOnMap={offline ? undefined : () => showOnMap(facility.cnes)}
                  onOpenDetail={() => setDetail(facility)}
                  headingRef={(node) => {
                    if (node) itemRefs.current.set(facility.cnes, node);
                    else itemRefs.current.delete(facility.cnes);
                  }}
                />
              </li>
            ))}
          </ul>
          {hasMore && municipality ? (
            <Button
              type="button"
              variant="secondary"
              disabled={status === "loading"}
              onClick={() => void search(municipality, typeCode, facilities.length)}
            >
              Carregar mais
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );

  return (
    <>
      <PageHeader title={SUPPORT_COPY.title} description={SUPPORT_COPY.description} />

      <p role="status" aria-live="polite" className="sr-only" data-testid="support-announcement">
        {announcement}
      </p>

      {demo ? (
        <div
          role="note"
          data-testid="support-demo-banner"
          className="mb-4 flex items-start gap-2 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink"
        >
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
          <span>
            <strong className="font-semibold">{SUPPORT_COPY.demoBanner}</strong> {SUPPORT_COPY.demoDetail}
          </span>
        </div>
      ) : null}

      {offline && savedAt ? (
        <div
          role="note"
          data-testid="support-offline-banner"
          className="mb-4 flex items-start gap-2 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink"
        >
          <CloudOff className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
          <span>{SUPPORT_COPY.offline(formatSavedAt(savedAt))}</span>
        </div>
      ) : null}

      {provenance ? (
        <p
          data-testid="support-provenance"
          data-freshness={provenance.freshness}
          className={cn(
            "mb-4 text-xs",
            provenance.freshness === "STALE" ? "font-medium text-attention" : "text-ink-muted",
          )}
        >
          Fonte: {supportSourceLabel(provenance)} ·{" "}
          {supportFreshnessCopy(provenance.freshness, supportReferenceLabel(provenance.referenceDate))}
        </p>
      ) : null}

      {municipalities === null ? (
        <ErrorState description="Não foi possível carregar a Rede de Apoio agora. Os contatos de ajuda continuam disponíveis." />
      ) : municipalities.length === 0 || !initialProvenance ? (
        <Card variant="muted">
          <CardContent className="flex flex-col gap-3 pt-5" data-testid="support-no-data">
            <p className="text-sm text-ink">{SUPPORT_COPY.noData}</p>
<SosPointer />
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="mb-5">
            <CardContent className="flex flex-col gap-4 pt-5">
              <form
                role="search"
                aria-label="Buscar serviços por município"
                className="flex flex-col gap-3 md:flex-row md:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (suggestions[0]) choose(suggestions[0]);
                }}
              >
                <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
                  <Label htmlFor={inputId}>Município</Label>
                  <Input
                    ref={inputRef}
                    id={inputId}
                    type="search"
                    autoComplete="off"
                    maxLength={80}
                    placeholder="Digite o nome do município"
                    value={query}
                    aria-controls={suggestionsOpen && suggestions.length > 0 ? suggestionsId : undefined}
                    aria-describedby={`${inputId}-hint`}
                    onChange={(event) => {
                      setQuery(event.target.value);
                      setSuggestionsOpen(true);
                    }}
                    onFocus={() => setSuggestionsOpen(true)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setSuggestionsOpen(false);
                    }}
                  />
                  <p id={`${inputId}-hint`} className="text-xs text-ink-subtle">
                    Só aparecem municípios com unidades na fonte. Busca por CEP não está disponível.
                  </p>
                  {suggestionsOpen && suggestions.length > 0 ? (
                    <ul
                      id={suggestionsId}
                      aria-label="Municípios encontrados"
                      className="z-10 flex max-h-72 flex-col overflow-y-auto rounded-control border border-line bg-surface p-1 shadow-raised md:absolute md:left-0 md:right-0 md:top-full md:mt-1"
                    >
                      {suggestions.map((item) => (
                        <li key={item.code}>
                          <button
                            type="button"
                            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-[0.5rem] px-3 text-left text-sm text-ink hover:bg-surface-muted focus-visible:bg-surface-muted"
                            onClick={() => choose(item)}
                          >
                            <span>{municipalityLabel(item)}</span>
                            <span className="text-xs text-ink-subtle">
                              {item.facilityCount} {item.facilityCount === 1 ? "unidade" : "unidades"}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {suggestionsOpen && query && suggestions.length === 0 ? (
                    <p className="text-xs text-ink-muted">Nenhum município com dados corresponde a “{query}”.</p>
                  ) : null}
                </div>
                <Button type="submit" variant="primary" disabled={suggestions.length === 0}>
                  <Search aria-hidden="true" />
                  Buscar
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={useMyLocation}
                  disabled={location.status === "requesting"}
                  data-testid="support-use-location"
                >
                  <LocateFixed aria-hidden="true" />
                  Usar minha localização
                </Button>
              </form>

              <div className="flex flex-col gap-1 text-sm" data-testid="support-location-status" data-location={location.status}>
                {location.status === "idle" ? <p className="text-ink-muted">{SUPPORT_COPY.locationIdle}</p> : null}
                {location.status === "requesting" ? <p className="text-ink-muted">{SUPPORT_COPY.locationRequesting}</p> : null}
                {location.status === "denied" ? <p className="text-ink">{SUPPORT_COPY.locationDenied}</p> : null}
                {location.status === "unavailable" ? <p className="text-ink">{SUPPORT_COPY.locationUnavailable}</p> : null}
                {location.status === "timeout" ? <p className="text-ink">{SUPPORT_COPY.locationTimeout}</p> : null}
                {location.status === "granted" && locationNote ? <p className="text-ink">{locationNote}</p> : null}
                {location.status === "granted" && !locationNote ? (
                  <p className="text-ink">Ordenado por distância aproximada, em linha reta.</p>
                ) : null}
                {location.status !== "granted" && locationNote ? <p className="text-ink">{locationNote}</p> : null}
                <p className="flex items-center gap-1.5 text-xs text-ink-subtle">
                  <ShieldCheck className="size-3.5" aria-hidden="true" />
                  {SUPPORT_COPY.locationPrivacy}
                </p>
              </div>

              {municipality && types.length > 0 ? (
                <div role="group" aria-label="Filtrar por tipo no cadastro" className="flex flex-wrap gap-2" data-testid="support-type-filter">
                  {[{ code: null as string | null, name: "Todos", facilityCount: null as number | null }, ...types].map((type) => {
                    const on = typeCode === type.code;
                    return (
                      <button
                        key={type.code ?? "all"}
                        type="button"
                        aria-pressed={on}
                        disabled={offline}
                        onClick={() => chooseType(type.code)}
                        className={cn(
                          "motion-press inline-flex min-h-10 items-center gap-1.5 rounded-pill border px-3 text-sm font-medium transition-colors disabled:opacity-50",
                          on ? "border-brand-300 bg-surface-brand text-brand-700" : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                        )}
                      >
                        {type.name}
                        {type.facilityCount !== null ? <span className="text-xs">({type.facilityCount})</span> : null}
                      </button>
                    );
                  })}
                </div>
              ) : null}
              <p className="text-xs text-ink-subtle">{SUPPORT_COPY.notEmergency}</p>
            </CardContent>
          </Card>

          {municipality ? (
            <>
              {!wide && !offline ? (
                <div role="group" aria-label="Modo de exibição" className="mb-3 inline-flex w-fit gap-1 rounded-control bg-surface-muted p-1">
                  {(["list", "map"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={view === mode}
                      onClick={() => setView(mode)}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-[0.625rem] px-4 text-sm font-medium text-ink-muted",
                        view === mode && "bg-surface text-brand-700 shadow-card",
                      )}
                    >
                      {mode === "list" ? "Lista" : "Mapa"}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={cn("grid items-start gap-5", wide && !offline && "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
                {listPanel}
                {!offline && facilities.length > 0 ? (
                  <div className={cn(view === "list" && !wide && "hidden", wide && "sticky top-20")}>
                    <SupportMap
                      points={points}
                      totalInList={facilities.length}
                      selectedCnes={selectedCnes}
                      onSelect={selectFromMap}
                      active={wide || view === "map"}
                    />
                  </div>
                ) : null}
              </div>
            </>
          ) : (municipalities ?? []).length > 0 && !offline ? (

            <section aria-labelledby="support-overview-title" data-testid="support-overview">
              <h2 id="support-overview-title" className="mb-1 text-base font-semibold text-ink">
                Onde há unidades cadastradas
              </h2>
              <p className="mb-3 text-sm text-ink-muted">
                Por estado e município. Escolha um município na lista ou no mapa para ver as unidades, com endereço e telefone quando existem.
              </p>
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end" data-testid="support-catalog-filters">
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <Label htmlFor={`${inputId}-catalogo`} className="text-xs text-ink-muted">Filtrar municípios</Label>
                  <Input
                    id={`${inputId}-catalogo`}
                    type="search"
                    value={catalogText}
                    onChange={(event) => setCatalogText(event.target.value)}
                    placeholder="Nome do município ou do estado"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-col gap-1 sm:w-56">
                  <Label htmlFor={`${inputId}-uf`} className="text-xs text-ink-muted">Estado</Label>
                  <select
                    id={`${inputId}-uf`}
                    value={catalogState}
                    onChange={(event) => setCatalogState(event.target.value)}
                    className="min-h-11 rounded-control border border-line bg-surface px-3 text-sm text-ink"
                  >
                    <option value="">Todos os estados</option>
                    {catalogStates.map((state) => (
                      <option key={state} value={state}>
                        {UF_NAMES[state] ?? state} — {state}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              {!overviewWide ? (
                <div role="group" aria-label="Modo de exibição" className="mb-3 inline-flex w-fit gap-1 rounded-control bg-surface-muted p-1">
                  {(["list", "map"] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={view === mode}
                      onClick={() => setView(mode)}
                      className={cn(
                        "inline-flex min-h-11 items-center rounded-[0.625rem] px-4 text-sm font-medium text-ink-muted",
                        view === mode && "bg-surface text-brand-700 shadow-card",
                      )}
                    >
                      {mode === "list" ? "Lista" : "Mapa"}
                    </button>
                  ))}
                </div>
              ) : null}
              <div className={cn("grid items-start gap-5", overviewWide && "grid-cols-[minmax(0,2fr)_minmax(0,3fr)]")}>
                <div className={cn("flex min-w-0 flex-col gap-3", view === "map" && !overviewWide && "hidden")} data-testid="support-overview-list">
                  {catalogGroups.length === 0 ? (
                    <p className="text-sm text-ink-muted" data-testid="support-catalog-empty">
                      Nenhum município com unidades para esse filtro.
                    </p>
                  ) : null}
                  {catalogGroups.map((group) => {
                    const open = isStateOpen(group.state);
                    const panelId = `${inputId}-uf-${group.state}`;
                    return (
                      <section key={group.state} aria-label={`${group.stateName} — ${group.state}`} data-testid="support-catalog-state" data-state={group.state}>
                        <button
                          type="button"
                          aria-expanded={open}
                          aria-controls={panelId}
                          onClick={() => toggleState(group.state, !open)}
                          className="flex min-h-11 w-full items-center justify-between gap-3 rounded-control px-1 text-left"
                        >
                          <span className="text-sm font-semibold text-ink">
                            {group.stateName} — {group.state}
                          </span>
                          <span className="text-xs text-ink-muted">
                            {plural(group.municipalities.length, "município", "municípios")} · {plural(group.facilityCount, "unidade", "unidades")}
                          </span>
                        </button>
                        {open ? (
                          <ul id={panelId} className="mt-1 flex flex-col gap-2">
                            {group.municipalities.map((item) => (
                              <li key={item.code}>
                                <button
                                  type="button"
                                  onClick={() => choose(item)}
                                  aria-label={`${municipalityLabel(item)} — ${plural(item.facilityCount, "unidade", "unidades")}`}
                                  className="motion-press flex min-h-12 w-full items-center justify-between gap-3 rounded-control border border-line bg-surface px-3.5 py-2 text-left text-sm transition-colors hover:bg-surface-muted"
                                >
                                  <span className="font-medium text-ink">{item.name ?? item.code}</span>
                                  <span className="text-xs text-ink-muted">{plural(item.facilityCount, "unidade", "unidades")}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                    );
                  })}
                </div>
                <div className={cn(view === "list" && !overviewWide && "hidden", overviewWide && "sticky top-20")}>
                  <SupportMap
                    points={overviewPoints}
                    totalInList={overviewPoints.length}
                    summaryText={`${plural(overviewPoints.length, "município aparece", "municípios aparecem")} no mapa${filtering ? " com o filtro atual" : ""}. A lista ao lado tem os mesmos.`}
                    selectedCnes={null}
                    onSelect={selectMunicipalityFromMap}
                    active={overviewWide || view === "map"}
                  />
                </div>
              </div>
            </section>
          ) : (
            <EmptyState
              size="compact"
              icon={<Search />}
              title="Escolha um município ou use sua localização"
              description="A lista mostra unidades públicas de saúde da fonte oficial, com endereço e telefone quando existem."
            />
          )}
        </>
      )}

      <FacilityDetailDialog
        facility={detail}
        provenance={provenance}
        distance={detail ? distanceOf(detail.cnes) : null}
        offline={offline}
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </>
  );
}


function SosPointer() {
  return (
    <p className="text-sm font-medium text-sos-strong" data-testid="support-sos-pointer">
      Em uma emergência ou risco imediato, use o botão SOS.
    </p>
  );
}
