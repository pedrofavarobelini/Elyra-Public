import type { Metadata } from "next";

import { PersonalizationContent } from "@/components/settings/personalization-content";
import { requireVerifiedProfessional } from "@/server/professional-gate";

export const metadata: Metadata = { title: "Personalização" };

export default async function ProPersonalizacaoPage() {
  await requireVerifiedProfessional();
  return <PersonalizationContent hubHref="/pro/configuracoes" />;
}
