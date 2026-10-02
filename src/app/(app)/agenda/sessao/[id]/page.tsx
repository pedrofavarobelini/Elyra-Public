import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SessionRoom } from "@/components/professional-session/session-room";
import { requireConsentedUser } from "@/server/auth";
import { getSessionDetail } from "@/server/services/professional-session-service";

export const metadata: Metadata = { title: "Sessão com profissional" };
export const dynamic = "force-dynamic";

/** A pessoa acessa a propria sessao pela Agenda. Sem participacao: 404. */
export default async function PessoaSessaoPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireConsentedUser();
  const { id } = await params;
  const detail = await getSessionDetail(supabase, id).catch(() => null);
  if (!detail || detail.role !== "client") notFound();
  return <SessionRoom detail={detail} />;
}
