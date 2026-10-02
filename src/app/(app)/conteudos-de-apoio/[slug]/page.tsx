import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { SupportContentArticle } from "@/components/support-content/support-content-article";
import { EmptyState } from "@/components/states";
import { SUPPORT_CONTENT_COPY } from "@/lib/support-content/catalog";
import { ARCHIVED_CONTENT, PUBLISHED_CONTENT } from "@/lib/support-content/corpus.generated";
import { REVIEW_CONTENT } from "@/lib/support-content/review.generated";
import { requireConsentedUser } from "@/server/auth";
import { supportContentPreviewEnabled } from "@/server/support-content/preview";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string }> };

function find(slug: string, preview: boolean) {
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) return null;
  return PUBLISHED_CONTENT.find((item) => item.slug === slug) ?? (preview ? REVIEW_CONTENT.find((item) => item.slug === slug) : undefined) ?? null;
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const item = find(slug, supportContentPreviewEnabled());
  return { title: item ? item.title : "Rede de Apoio" };
}

export default async function SupportContentReadPage({ params }: Params) {
  await requireConsentedUser();
  const { slug } = await params;
  const preview = supportContentPreviewEnabled();
  const item = find(slug, preview);
  if (item) return <SupportContentArticle item={item} preview={preview} />;
  if (ARCHIVED_CONTENT.some((archived) => archived.slug === slug)) {
    return (
      <EmptyState
        title={SUPPORT_CONTENT_COPY.archived}
        action={<Link href="/conteudos-de-apoio" className="text-sm font-medium text-brand-700 underline-offset-4 hover:underline">Ver outros conteúdos</Link>}
      />
    );
  }
  notFound();
}
