"use client";

import { CloudOff } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { HelpContacts } from "@/components/help/help-contacts";
import { PageHeader } from "@/components/journey/page-header";
import { EmptyState } from "@/components/states";
import { Disclosure } from "@/components/ui/disclosure";
import type { SupportFacility } from "@/lib/contracts/support-network";
import { SUPPORT_COPY, supportFreshnessCopy, supportReferenceLabel, supportSourceLabel } from "@/lib/support-network/copy";
import { createSupportCache, type SupportCacheEntry } from "@/lib/support-network/offline-cache";

import { FacilityCard, FacilityDetailDialog } from "./facility-card";

/**
 * Rede de Apoio sem rede (shell offline, ADR-0014 + ADR-0032): so as listas
 * salvas neste aparelho (ate 3, ate 30 dias), com a data em que foram salvas.
 * Sem mapa (tiles nunca sao guardados) e sem rota; "Ligar" funciona.
 */
export function SupportNetworkOfflineView() {
  const cache = useMemo(() => createSupportCache(), []);
  const [entries, setEntries] = useState<SupportCacheEntry[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [detail, setDetail] = useState<SupportFacility | null>(null);

  useEffect(() => {
    void cache.recent().then((list) => {
      setEntries(list);
      setActive(list[0]?.key ?? null);
    });
  }, [cache]);

  const entry = entries?.find((item) => item.key === active) ?? null;
  const savedAt = entry
    ? new Date(entry.cachedAt).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <>
      <PageHeader title={SUPPORT_COPY.title} description="Lista salva neste aparelho para consulta sem internet." />
      {entries === null ? null : entries.length === 0 || !entry ? (
        <div className="flex flex-col gap-3">
          <EmptyState
            icon={<CloudOff />}
            title="Nenhuma lista salva neste aparelho"
            description="A Rede de Apoio guarda a última busca feita com conexão. Os contatos de ajuda imediata funcionam sem internet."
          />
          <Disclosure summary="Contatos de ajuda imediata" defaultOpen>
            <div className="pt-2">
              <HelpContacts />
            </div>
          </Disclosure>
        </div>
      ) : (
        <div className="flex flex-col gap-3" data-testid="support-offline-list">
          <p role="note" className="flex items-start gap-2 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink">
            <CloudOff className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
            {SUPPORT_COPY.offline(savedAt!)}
          </p>
          {entry.provenance?.isFixture ? (
            <p role="note" className="text-sm font-medium text-attention">{SUPPORT_COPY.demoBanner}</p>
          ) : null}
          {entry.provenance ? (
            <p className="text-xs text-ink-muted">
              Fonte: {supportSourceLabel(entry.provenance)} ·{" "}
              {supportFreshnessCopy(entry.provenance.freshness, supportReferenceLabel(entry.provenance.referenceDate))}
            </p>
          ) : null}
          {entries.length > 1 ? (
            <div role="group" aria-label="Listas salvas" className="flex flex-wrap gap-2">
              {entries.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={item.key === active}
                  onClick={() => setActive(item.key)}
                  className="inline-flex min-h-10 items-center rounded-pill border border-line bg-surface px-3 text-sm font-medium text-ink-muted aria-pressed:border-brand-300 aria-pressed:bg-surface-brand aria-pressed:text-brand-700"
                >
                  {item.municipalityLabel}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm font-medium text-ink">{entry.municipalityLabel}</p>
          )}
          <ul className="flex flex-col gap-3" aria-label="Serviços salvos">
            {entry.facilities.map((facility) => (
              <li key={facility.cnes}>
                <FacilityCard
                  facility={facility}
                  distance={null}
                  demo={entry.provenance?.isFixture ?? false}
                  offline
                  selected={false}
                  onOpenDetail={() => setDetail(facility)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}
      <FacilityDetailDialog
        facility={detail}
        provenance={entry?.provenance ?? null}
        distance={null}
        offline
        onOpenChange={(open) => {
          if (!open) setDetail(null);
        }}
      />
    </>
  );
}
