"use client";

import { ExternalLink, Info, MapPin, Navigation, Phone } from "lucide-react";
import type { Ref } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { SupportFacility, SupportProvenance } from "@/lib/contracts/support-network";
import { supportAddressLine, supportRouteUrl, supportTelHref } from "@/lib/support-network/actions";
import {
  SUPPORT_COPY,
  supportFreshnessCopy,
  supportReferenceLabel,
  supportSourceLabel,
} from "@/lib/support-network/copy";
import { cn } from "@/lib/utils";

/**
 * Card de unidade (SUP-2). So o que a fonte tem; nada automatico. Todo texto
 * da fonte entra como texto React (escapado) — nunca HTML. O nome do tipo
 * oficial aparece literal. "Selecionado" nao e so cor: tem rotulo.
 */
export function FacilityCard({
  facility,
  distance,
  demo,
  offline,
  selected,
  onShowOnMap,
  onOpenDetail,
  headingRef,
}: {
  facility: SupportFacility;
  distance: string | null;
  demo: boolean;
  offline: boolean;
  selected: boolean;
  onShowOnMap?: () => void;
  onOpenDetail: () => void;
  headingRef?: Ref<HTMLButtonElement>;
}) {
  const tel = supportTelHref(facility.phone);
  const route = supportRouteUrl(facility);
  const titleId = `unidade-${facility.cnes}`;
  return (
    <article
      aria-labelledby={titleId}
      data-cnes={facility.cnes}
      data-selected={selected || undefined}
      className={cn(
        "flex flex-col gap-2 rounded-panel border bg-surface p-4 transition-colors",
        selected ? "border-brand-600 ring-2 ring-brand-600/40" : "border-line",
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="min-w-0 text-base font-semibold text-ink">
          <button
            ref={headingRef}
            id={titleId}
            type="button"
            onClick={onOpenDetail}
            className="text-left underline-offset-4 hover:underline focus-visible:underline"
          >
            {facility.name}
          </button>
        </h3>
        {selected ? <Badge tone="brand">Selecionada no mapa</Badge> : null}
      </div>
      <p className="text-xs text-ink-muted">
        <span className="font-medium text-ink">Tipo no cadastro:</span> {facility.officialType.name}
      </p>
      {supportAddressLine(facility) ? (
        <p className="flex items-start gap-1.5 text-sm text-ink-muted">
          <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{supportAddressLine(facility)}</span>
        </p>
      ) : null}
      {distance ? (
        <p className="text-sm text-ink" data-testid="support-distance">
          {distance} <span className="text-xs text-ink-subtle">({SUPPORT_COPY.distanceNote})</span>
        </p>
      ) : null}
      {facility.phone ? (
        <p className="text-sm text-ink-muted">
          Telefone: <span className="text-ink">{facility.phone.display}</span>
          {demo ? <span className="text-xs text-ink-subtle"> (fictício)</span> : null}
        </p>
      ) : null}
      <div className="mt-1 flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onOpenDetail}>
          <Info aria-hidden="true" />
          Ver detalhes
        </Button>
        {tel ? (
          <Button asChild variant="secondary" size="sm">
            <a href={tel} aria-label={`Ligar para ${facility.name}`}>
              <Phone aria-hidden="true" />
              Ligar
            </a>
          </Button>
        ) : null}
        {route && !offline ? (
          <Button asChild variant="secondary" size="sm">
            <a href={route} target="_blank" rel="noopener noreferrer" aria-label={`Abrir rota até ${facility.name} (abre em nova aba)`}>
              <Navigation aria-hidden="true" />
              Abrir rota
            </a>
          </Button>
        ) : null}
        {route && offline ? <span className="self-center text-xs text-ink-subtle">{SUPPORT_COPY.routeOffline}</span> : null}
        {onShowOnMap && facility.coordinates ? (
          <Button type="button" variant="ghost" size="sm" onClick={onShowOnMap} aria-label={`Ver ${facility.name} no mapa`}>
            <MapPin aria-hidden="true" />
            Ver no mapa
          </Button>
        ) : null}
      </div>
    </article>
  );
}

export function FacilityDetailDialog({
  facility,
  provenance,
  distance,
  offline,
  onOpenChange,
}: {
  facility: SupportFacility | null;
  provenance: SupportProvenance | null;
  distance: string | null;
  offline: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const tel = facility ? supportTelHref(facility.phone) : null;
  const route = facility ? supportRouteUrl(facility) : null;
  const demo = provenance?.isFixture ?? false;
  const updated = facility?.sourceUpdatedAt ? /^(\d{4})-(\d{2})-(\d{2})/.exec(facility.sourceUpdatedAt) : null;
  return (
    <Dialog open={facility !== null} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="support-detail">
        {facility ? (
          <>
            <DialogHeader>
              <DialogTitle>{facility.name}</DialogTitle>
              <DialogDescription>Tipo no cadastro: {facility.officialType.name}</DialogDescription>
            </DialogHeader>
            {demo ? (
              <p className="rounded-control border border-attention/30 bg-attention-soft px-3 py-2 text-sm font-medium text-ink">
                {SUPPORT_COPY.demoBanner}
              </p>
            ) : null}
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-ink-muted">Endereço</dt>
              <dd className="text-ink">{supportAddressLine(facility) || "Não informado na fonte"}</dd>
              {facility.address.complement ? (
                <>
                  <dt className="text-ink-muted">Complemento</dt>
                  <dd className="text-ink">{facility.address.complement}</dd>
                </>
              ) : null}
              {facility.address.postalCode ? (
                <>
                  <dt className="text-ink-muted">CEP</dt>
                  <dd className="text-ink">{facility.address.postalCode.replace(/^(\d{5})(\d{3})$/, "$1-$2")}</dd>
                </>
              ) : null}
              <dt className="text-ink-muted">Telefone</dt>
              <dd className="text-ink">
                {facility.phone?.display ?? "Não informado na fonte"}
                {demo && facility.phone ? " (fictício)" : ""}
              </dd>
              {distance ? (
                <>
                  <dt className="text-ink-muted">Distância</dt>
                  <dd className="text-ink">
                    {distance} <span className="text-xs text-ink-subtle">({SUPPORT_COPY.distanceNote})</span>
                  </dd>
                </>
              ) : null}
              {facility.coordinateStatus !== "valid" ? (
                <>
                  <dt className="text-ink-muted">Mapa</dt>
                  <dd className="text-ink">Sem localização válida na fonte; não aparece no mapa.</dd>
                </>
              ) : null}
              <dt className="text-ink-muted">{demo ? "Código (fictício)" : "CNES"}</dt>
              <dd className="text-ink">{facility.cnes}</dd>
              {provenance ? (
                <>
                  <dt className="text-ink-muted">Fonte</dt>
                  <dd className="text-ink">{supportSourceLabel(provenance)}</dd>
                  <dt className="text-ink-muted">Dados</dt>
                  <dd className="text-ink">
                    {supportFreshnessCopy(provenance.freshness, supportReferenceLabel(provenance.referenceDate))}
                  </dd>
                </>
              ) : null}
              {updated ? (
                <>
                  <dt className="text-ink-muted">Registro</dt>
                  <dd className="text-ink">atualizado na fonte em {`${updated[3]}/${updated[2]}/${updated[1]}`}</dd>
                </>
              ) : null}
            </dl>
            <p className="text-sm text-ink-muted">{SUPPORT_COPY.confirmBeforeGoing}</p>
            <p className="text-sm font-medium text-sos-strong">{SUPPORT_COPY.notEmergency}</p>
            <div className="flex flex-wrap gap-2">
              {tel ? (
                <Button asChild variant="primary" size="sm">
                  <a href={tel}>
                    <Phone aria-hidden="true" />
                    Ligar
                  </a>
                </Button>
              ) : null}
              {route && !offline ? (
                <Button asChild variant="secondary" size="sm">
                  <a href={route} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Abrir rota
                    <span className="sr-only"> (abre em nova aba)</span>
                  </a>
                </Button>
              ) : null}
            </div>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
