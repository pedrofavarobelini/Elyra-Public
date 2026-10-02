import type { Metadata } from "next";

import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getMyHelpRequests } from "@/server/services/help-request-service";
import { ProHelpRequestsView } from "./view";

export const metadata: Metadata = { title: "Recados das pessoas" };
export const dynamic = "force-dynamic";


export default async function ProHelpRequestsPage() {
  const { supabase } = await requireVerifiedProfessional();
  let requests = null;
  try {
    requests = (await getMyHelpRequests(supabase)).filter((item) => item.role === "professional");
  } catch {
    requests = null;
  }
  return <ProHelpRequestsView requests={requests} />;
}
