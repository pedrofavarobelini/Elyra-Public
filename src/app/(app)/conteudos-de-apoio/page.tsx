import type { Metadata } from "next";
import { Suspense } from "react";

import { SupportContentLanding } from "@/components/support-content/support-content-landing";
import { PUBLISHED_CONTENT } from "@/lib/support-content/corpus.generated";
import { REVIEW_CONTENT } from "@/lib/support-content/review.generated";
import { requireConsentedUser } from "@/server/auth";
import { supportContentPreviewEnabled } from "@/server/support-content/preview";

export const metadata: Metadata = { title: "Rede de Apoio" };
export const dynamic = "force-dynamic";

/**
 * Conteudos de Apoio (SUP-3, ADR-0033). Corpus versionado no repositorio;
 * so PUBLISHED aparece. REVIEW so no modo de pre-visualizacao (fora de producao).
 */
export default async function SupportContentPage() {
  await requireConsentedUser();
  const preview = supportContentPreviewEnabled();
  const items = preview ? [...PUBLISHED_CONTENT, ...REVIEW_CONTENT] : PUBLISHED_CONTENT;
  return (
    <Suspense>
      <SupportContentLanding items={items} preview={preview} />
    </Suspense>
  );
}
