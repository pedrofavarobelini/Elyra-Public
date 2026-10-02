import type { Metadata } from "next";

import SegurancaPage from "@/app/(app)/seguranca/page";
import { requireVerifiedProfessional } from "@/server/professional-gate";

export const metadata: Metadata = { title: "Segurança" };

/** F4: a mesma pagina de seguranca da conta, no shell profissional. */
export default async function ProSegurancaPage() {
  await requireVerifiedProfessional();
  return SegurancaPage();
}
