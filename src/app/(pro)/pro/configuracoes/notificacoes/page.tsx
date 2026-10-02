import type { Metadata } from "next";

import NotificacoesPage from "@/app/(app)/notificacoes/page";
import { requireVerifiedProfessional } from "@/server/professional-gate";

export const metadata: Metadata = { title: "Notificações" };

/** F4: as mesmas preferencias (uma so matriz por conta), no shell profissional. */
export default async function ProNotificacoesPage() {
  await requireVerifiedProfessional();
  return NotificacoesPage();
}
