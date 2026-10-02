import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SessionRoom } from "@/components/professional-session/session-room";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getSessionDetail } from "@/server/services/professional-session-service";

export const metadata: Metadata = { title: "Sessão" };
export const dynamic = "force-dynamic";

/** UUID nao autoriza: sem participacao, a RPC nao devolve nada e a pagina e 404. */
export default async function ProSessaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireVerifiedProfessional();
  const { id } = await params;
  const detail = await getSessionDetail(supabase, id).catch(() => null);
  if (!detail || detail.role !== "professional") notFound();
  return <SessionRoom detail={detail} />;
}
