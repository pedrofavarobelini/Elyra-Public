import { ArrowLeft, ExternalLink, House, UserRoundSearch } from "lucide-react";
import Link from "next/link";

import { OfflineLinkNote } from "./offline-link-note";

import { HelpContacts } from "@/components/help/help-contacts";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUPPORT_CONTENT_COPY, formatContentDate } from "@/lib/support-content/catalog";
import type { ContentItem } from "@/lib/support-content/content-model";
import { CONTENT_CATEGORIES, CONTENT_CTAS } from "@/lib/support-content/policy";

import { ContentBody } from "./content-body";

/**
 * Leitura de um conteudo (SUP-3). Texto proprio e curto da Elyra, fonte e
 * link original explicitos. O CTA de SOS reusa a lista CENTRAL de contatos
 * (`HelpContacts`), nunca uma copia de telefones.
 */
export function SupportContentArticle({ item, preview }: { item: ContentItem; preview: boolean }) {
  const reviewed = item.status === "PUBLISHED" ? formatContentDate(item.reviewedAt) : null;
  const published = formatContentDate(item.publishedAt);
  const checked = formatContentDate(item.lastCheckedAt);
  return (
    <article aria-labelledby="conteudo-titulo" className="mx-auto flex w-full max-w-3xl flex-col gap-6" data-slug={item.slug}>
      <Link href="/conteudos-de-apoio" className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-brand-700 underline-offset-4 hover:underline">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Rede de Apoio
      </Link>

      {preview || item.status !== "PUBLISHED" ? (
        <p role="note" data-testid="content-preview-banner" className="rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3 text-sm text-ink">
          {SUPPORT_CONTENT_COPY.preview}
        </p>
      ) : null}

      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Badge tone="brand">{CONTENT_CATEGORIES[item.category].label}</Badge>
          {item.status !== "PUBLISHED" ? <Badge tone="attention">Em revisão</Badge> : null}
        </div>
        <h1 id="conteudo-titulo" className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {item.title}
        </h1>
        <p className="text-base text-ink-muted">{item.summary}</p>
      </header>

      <ContentBody blocks={item.body} />

      <section aria-labelledby="conteudo-fonte" className="flex flex-col gap-3 rounded-panel border border-line bg-surface-muted p-5" data-testid="content-source">
        <h2 id="conteudo-fonte" className="text-sm font-semibold text-ink">Fonte</h2>
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
          <dt className="text-ink-muted">Publicado por</dt>
          <dd className="text-ink">{item.publisherName}</dd>
          <dt className="text-ink-muted">Título original</dt>
          <dd className="text-ink">{item.sourceTitle}</dd>
          {item.author ? (
            <>
              <dt className="text-ink-muted">Autoria</dt>
              <dd className="text-ink">{item.author}</dd>
            </>
          ) : null}
          {published ? (
            <>
              <dt className="text-ink-muted">Publicação</dt>
              <dd className="text-ink">{published}</dd>
            </>
          ) : null}
          {checked ? (
            <>
              <dt className="text-ink-muted">Fonte consultada em</dt>
              <dd className="text-ink">{checked}</dd>
            </>
          ) : null}
          <dt className="text-ink-muted">Revisão da Elyra</dt>
          <dd className="text-ink">{reviewed ? `${reviewed} · versão ${item.version}` : "Em revisão — ainda não revisado"}</dd>
        </dl>
        <p className="text-xs text-ink-subtle">
          Resumo e texto escritos pela Elyra. O conteúdo completo pertence à fonte original.
        </p>
        <Button asChild variant="secondary" className="self-start">
          <a href={item.originalUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink aria-hidden="true" />
            {SUPPORT_CONTENT_COPY.originalLink}
            <span className="sr-only"> (abre em nova aba, {item.publisherName})</span>
            <OfflineLinkNote />
          </a>
        </Button>
      </section>

      {item.cta === "rede-de-apoio" || item.cta === "profissionais" ? (
        <Button asChild variant="soft" className="self-start">
          <Link href={CONTENT_CTAS[item.cta].href}>
            {item.cta === "rede-de-apoio" ? <House aria-hidden="true" /> : <UserRoundSearch aria-hidden="true" />}
            {CONTENT_CTAS[item.cta].label}
          </Link>
        </Button>
      ) : null}

      {item.cta === "sos" ? (
        <section id="contatos-de-ajuda" aria-labelledby="conteudo-ajuda" className="flex flex-col gap-3 border-t border-line pt-5">
          <h2 id="conteudo-ajuda" className="text-base font-semibold text-ink">Contatos de ajuda imediata</h2>
          <HelpContacts />
        </section>
      ) : (
        <p className="text-sm text-ink-muted">{SUPPORT_CONTENT_COPY.notice}</p>
      )}
    </article>
  );
}
