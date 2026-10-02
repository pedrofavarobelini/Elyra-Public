import type { Metadata } from "next";

import { PersonalizationContent } from "@/components/settings/personalization-content";
import { requireAuthenticatedUser } from "@/server/auth";

export const metadata: Metadata = { title: "Personalização" };

/**
 * Personalizacao — detalhe do hub de Configuracoes. Preferencias locais por
 * conta neste aparelho; nenhuma leitura de banco.
 */
export default async function PersonalizacaoPage() {
  await requireAuthenticatedUser();
  return <PersonalizationContent hubHref="/configuracoes" />;
}
