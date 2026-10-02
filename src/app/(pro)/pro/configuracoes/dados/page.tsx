import type { Metadata } from "next";

import { DataRightsContent } from "@/components/settings/data-rights-content";
import { requireVerifiedProfessional } from "@/server/professional-gate";

export const metadata: Metadata = { title: "Seus dados" };

export default async function ProDadosPage() {
  await requireVerifiedProfessional();
  return <DataRightsContent hubHref="/pro/configuracoes" privacyHref="/configuracoes/privacidade" />;
}
