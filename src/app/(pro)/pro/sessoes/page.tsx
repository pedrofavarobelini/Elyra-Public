import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getMySessions } from "@/server/services/professional-session-service";
import { SessionListView } from "@/components/professional-session/session-list";

export const metadata: Metadata = { title: "Sessões" };
export const dynamic = "force-dynamic";


export default async function ProSessoesPage() {
  const { supabase } = await requireVerifiedProfessional();
  const sessions = await getMySessions(supabase).catch(() => null);
  return (
    <SessionListView
      now={new Date().toISOString()}
      sessions={sessions?.filter((item) => item.role === "professional") ?? null}
      basePath="/pro/sessoes"
    />
  );
}
