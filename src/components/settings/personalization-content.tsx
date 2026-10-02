import type { Route } from "next";
import Link from "next/link";

import { PersonalizationCenter } from "@/components/accessibility/personalization-center";
import { PageHeader } from "@/components/journey/page-header";

/** Personalizacao (F4): mesmos controles nos dois contextos; muda so o "voltar". */
export function PersonalizationContent({ hubHref }: { hubHref: string }) {
  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={hubHref as Route}
            className="inline-flex min-h-11 items-center text-sm font-medium text-brand-700 hover:underline lg:min-h-0"
          >
            ← Voltar para o hub de ajustes
          </Link>
        }
        title="Personalização"
        description="Escolha como a Elyra aparece e se adapta a você. Vale para este aparelho e funciona offline."
      />
      <PersonalizationCenter />
    </>
  );
}
