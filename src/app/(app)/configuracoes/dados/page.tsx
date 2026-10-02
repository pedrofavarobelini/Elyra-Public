import type { Metadata } from "next";

import { DataRightsContent } from "@/components/settings/data-rights-content";
import { requireAuthenticatedUser } from "@/server/auth";

export const metadata: Metadata = { title: "Seus dados" };

export default async function DadosPage() {
  await requireAuthenticatedUser();
  return <DataRightsContent hubHref="/configuracoes" privacyHref="/configuracoes/privacidade" />;
}
