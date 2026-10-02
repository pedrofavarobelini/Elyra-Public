"use client";

import { ExternalLink, FlaskConical, Info, MapPin, Search } from "lucide-react";

import { OfflineLinkNote } from "./offline-link-note";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useId, useMemo, useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { ProductArtwork } from "@/components/product/product-artwork";
import { EmptyState } from "@/components/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SUPPORT_CONTENT_COPY, filterContent, isContentCategory } from "@/lib/support-content/catalog";
import type { ContentItem } from "@/lib/support-content/content-model";
import { CONTENT_CATEGORIES, CONTENT_SOURCES, TRUSTED_EXTERNAL_RESOURCES, type ContentCategory } from "@/lib/support-content/policy";
import { cn } from "@/lib/utils";

import { ContentCard } from "./content-card";

/**
 * Conteudos de Apoio (SUP-3, ADR-0033) — landing editorial.
 *
 * Busca e filtro no cliente (corpus local e pequeno). A categoria vai na URL
 * (`?categoria=`), para ser linkavel; a busca fica so na tela. Nenhuma
 * requisicao de rede e feita aqui.
 */
export function SupportContentLanding({ items, preview }: { items: readonly ContentItem[]; preview: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const searchId = useId();
  const [query, setQuery] = useState("");
  const rawCategory = params.get("categoria");
  const category: ContentCategory | null = isContentCategory(rawCategory) ? rawCategory : null;
  const results = useMemo(() => filterContent(items, query, category), [items, query, category]);
  const used = useMemo(() => new Set(items.map((item) => item.category)), [items]);
  const categories = (Object.keys(CONTENT_CATEGORIES) as ContentCategory[]).filter((key) => used.has(key));

  const setCategory = (next: ContentCategory | null) => {
    const search = new URLSearchParams(params.toString());
    if (next) search.set("categoria", next);
    else search.delete("categoria");
    const qs = search.toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  };

  return (
    <>
      <PageHeader title={SUPPORT_CONTENT_COPY.title} description={SUPPORT_CONTENT_COPY.description} />

      <div
        className="relative mb-5 h-28 overflow-hidden rounded-card border border-line bg-surface-brand sm:h-36 lg:h-40"
        data-testid="support-content-artwork"
      >
        <ProductArtwork
          avifSrc="/placeholder/artwork.svg"
          webpSrc="/placeholder/artwork.svg"
          width={1344}
          height={768}
          eager
          className="absolute inset-0"
          imageClassName="h-full w-full object-cover object-center dark:brightness-[0.45] dark:contrast-125 dark:saturate-[1.1]"
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-r from-surface-brand/35 via-transparent to-surface-brand/20 dark:from-surface/35 dark:to-surface/20"
        />
      </div>

      {preview ? (
        <div role="note" data-testid="content-preview-banner" className="mb-4 flex items-start gap-2 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink">
          <FlaskConical className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
          <span>{SUPPORT_CONTENT_COPY.preview}</span>
        </div>
      ) : null}

      <p className="mb-5 flex items-start gap-2 text-sm text-ink-muted" data-testid="content-notice">
        <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        {SUPPORT_CONTENT_COPY.notice}
      </p>

      {items.length === 0 ? (
        <EmptyState icon={<Info />} title="Nada publicado por enquanto" description={SUPPORT_CONTENT_COPY.empty} />
      ) : (
        <>
          <div className="mb-5 flex flex-col gap-4">
            <div className="flex max-w-xl flex-col gap-1.5" role="search" aria-label="Buscar conteúdos">
              <Label htmlFor={searchId}>Buscar</Label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" aria-hidden="true" />
                <Input
                  id={searchId}
                  type="search"
                  maxLength={80}
                  autoComplete="off"
                  placeholder="Ex.: CAPS, direitos, registro"
                  className="pl-9"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </div>
            </div>
            <div role="group" aria-label="Filtrar por categoria" className="flex flex-wrap gap-2" data-testid="content-category-filter">
              {[null, ...categories].map((key) => {
                const on = category === key;
                return (
                  <button
                    key={key ?? "todas"}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCategory(key)}
                    className={cn(
                      "motion-press inline-flex min-h-10 items-center rounded-pill border px-3 text-sm font-medium transition-colors",
                      on ? "border-brand-300 bg-surface-brand text-brand-700" : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
                    )}
                  >
                    {key ? CONTENT_CATEGORIES[key].label : "Todas"}
                  </button>
                );
              })}
            </div>
          </div>

          <p role="status" aria-live="polite" className="sr-only" data-testid="content-announcement">
            {results.length === 0 ? SUPPORT_CONTENT_COPY.noMatch : `${results.length} ${results.length === 1 ? "conteúdo" : "conteúdos"}.`}
          </p>

          {results.length === 0 ? (
            <EmptyState size="compact" icon={<Search />} title={SUPPORT_CONTENT_COPY.noMatch} description="Tente outra palavra ou remova o filtro de categoria." />
          ) : (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Conteúdos" data-testid="content-list">
              {results.map((item) => (
                <li key={item.slug}>
                  <ContentCard item={item} />
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {/*
        Rede de Apoio EDITORIAL: fontes externas confiaveis (lista central,
        allowlist) e, separado dos artigos, o caminho para o MAPA de servicos.
        Aparece mesmo sem artigo publicado.
      */}
      <section aria-labelledby="rede-apoio-externa" className="mt-8 grid gap-4 md:grid-cols-2" data-testid="support-external">
        <div className="flex flex-col gap-3 rounded-card border border-line bg-surface p-5">
          <h2 id="rede-apoio-externa" className="text-base font-semibold text-ink">
            {SUPPORT_CONTENT_COPY.externalTitle}
          </h2>
          <p className="text-xs text-ink-muted">{SUPPORT_CONTENT_COPY.externalNotice}</p>
          <ul className="flex flex-col gap-4">
            {TRUSTED_EXTERNAL_RESOURCES.map((resource) => (
              <li key={resource.id} className="flex flex-col gap-1.5">
                <p className="text-sm font-medium text-ink">{resource.title}</p>
                <p className="text-sm text-ink-muted">{resource.description}</p>
                <p className="text-xs text-ink-subtle">Fonte: {CONTENT_SOURCES[resource.source].name}</p>
                <a
                  href={resource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  {SUPPORT_CONTENT_COPY.externalAction}
                  <span className="sr-only"> ({CONTENT_SOURCES[resource.source].name}, abre em nova aba)</span>
                  <ExternalLink className="size-4" aria-hidden="true" />
                  <OfflineLinkNote />
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-dashed border-line bg-surface-muted/60 p-5" data-testid="support-map-cta">
          <h2 className="flex items-center gap-2 text-base font-semibold text-ink">
            <MapPin className="size-4 text-brand-700" aria-hidden="true" />
            {SUPPORT_CONTENT_COPY.mapTitle}
          </h2>
          <p className="text-sm text-ink-muted">{SUPPORT_CONTENT_COPY.mapDescription}</p>
          <Link
            href="/rede-de-apoio"
            prefetch={false}
            className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-brand-700 underline-offset-4 hover:underline"
          >
            {SUPPORT_CONTENT_COPY.mapAction}
          </Link>
        </div>
      </section>
    </>
  );
}
