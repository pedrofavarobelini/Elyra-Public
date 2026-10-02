import type { Metadata } from "next";

import { requireConsentedUser } from "@/server/auth";
import {
  getMyHelpRequests,
  getMyHelpRequestTargets,
} from "@/server/services/help-request-service";
import { HelpRequestsPersonView } from "./view";

export const metadata: Metadata = { title: "Recados ao profissional" };
// ONLINE_ONLY: pedido guardado no aparelho seria confundido com recebido.
export const dynamic = "force-dynamic";


export default async function HelpRequestsPage() {
  const { supabase } = await requireConsentedUser();
  const [requests, targets] = await Promise.allSettled([
    getMyHelpRequests(supabase),
    getMyHelpRequestTargets(supabase),
  ]);
  return (
    <HelpRequestsPersonView
      requests={requests.status === "fulfilled" ? requests.value.filter((item) => item.role === "client") : null}
      targets={targets.status === "fulfilled" ? targets.value : null}
    />
  );
}
