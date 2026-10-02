"use client";

import { Suspense } from "react";

import { ARCHIVED_CONTENT, PUBLISHED_CONTENT } from "@/lib/support-content/corpus.generated";
import { SUPPORT_CONTENT_COPY } from "@/lib/support-content/catalog";

import { SupportContentArticle } from "./support-content-article";
import { SupportContentLanding } from "./support-content-landing";

/**
 * Conteudos de Apoio sem rede (shell offline, ADR-0014 + ADR-0033). O corpus
 * PUBLICADO e texto no bundle: nada para buscar, nada para guardar. REVIEW
 * nunca chega aqui. O link para a fonte original precisa de internet.
 */
export function SupportContentOfflineView({ route }: { route: string }) {
  const slug = route.replace(/^\/conteudos-de-apoio\/?/, "").split(/[/?#]/)[0] ?? "";
  if (slug) {
    const item = PUBLISHED_CONTENT.find((entry) => entry.slug === slug);
    if (item) return <SupportContentArticle item={item} preview={false} />;
    const archived = ARCHIVED_CONTENT.some((entry) => entry.slug === slug);
    return <p className="text-sm text-ink-muted">{archived ? SUPPORT_CONTENT_COPY.archived : "Conteúdo não encontrado."}</p>;
  }
  return (
    <Suspense>
      <SupportContentLanding items={PUBLISHED_CONTENT} preview={false} />
    </Suspense>
  );
}
