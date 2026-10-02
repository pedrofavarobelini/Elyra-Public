import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { formatContentDate } from "@/lib/support-content/catalog";
import type { ContentItem } from "@/lib/support-content/content-model";
import { CONTENT_CATEGORIES } from "@/lib/support-content/policy";

/** Card editorial: categoria, titulo, resumo proprio, fonte e revisao. Sem imagem de terceiro. */
export function ContentCard({ item }: { item: ContentItem }) {
  const titleId = `conteudo-${item.slug}`;
  const reviewed = formatContentDate(item.status === "PUBLISHED" ? item.reviewedAt : null);
  return (
    <article aria-labelledby={titleId} data-slug={item.slug} className="flex h-full flex-col gap-3 rounded-panel border border-line bg-surface p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="brand">{CONTENT_CATEGORIES[item.category].label}</Badge>
        {item.status !== "PUBLISHED" ? <Badge tone="attention">Em revisão</Badge> : null}
      </div>
      <h3 id={titleId} className="text-base font-semibold leading-snug text-ink">
        {item.title}
      </h3>
      <p className="text-sm text-ink-muted">{item.summary}</p>
      <p className="mt-auto text-xs text-ink-subtle">
        Fonte: {item.publisherName}
        {reviewed ? ` · revisado em ${reviewed}` : ""} · {item.readingMinutes} min de leitura
      </p>
      <Link
        href={`/conteudos-de-apoio/${item.slug}`}
        className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-semibold text-brand-700 underline-offset-4 hover:underline"
        aria-label={`Ler conteúdo: ${item.title}`}
      >
        Ler conteúdo
        <ArrowRight className="size-4" aria-hidden="true" />
      </Link>
    </article>
  );
}
