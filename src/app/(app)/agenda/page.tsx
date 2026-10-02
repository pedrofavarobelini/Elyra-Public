import type { Metadata } from "next";

import { requireConsentedUser } from "@/server/auth";
import {
  getMyAppointments,
  getMySchedulingProfessionals,
} from "@/server/services/appointment-service";
import { getMySessions } from "@/server/services/professional-session-service";
import { PersonAgendaView } from "./view";

export const metadata: Metadata = { title: "Sessão com profissional" };
// ONLINE_ONLY (D-P6-14): disponibilidade de cache mentiria.
export const dynamic = "force-dynamic";

/**
 * "Sessao com profissional" (ADR-0029): mesma rota da agenda da pessoa
 * (PRO-6), agora parte de Sessoes no menu. Profissionais vinculados no topo;
 * Proximas / Agendar / Historico reaproveitam agenda, sessao e chamada.
 */
export default async function PersonAgendaPage({
  searchParams,
}: {
  searchParams: Promise<{ vinculo?: string }>;
}) {
  const { supabase } = await requireConsentedUser();
  const [professionals, appointments, sessions] = await Promise.allSettled([
    getMySchedulingProfessionals(supabase),
    getMyAppointments(supabase),
    getMySessions(supabase),
  ]);
  const { vinculo } = await searchParams;
  return (
    <PersonAgendaView
      now={new Date().toISOString()}
      professionals={professionals.status === "fulfilled" ? professionals.value : null}
      appointments={
        appointments.status === "fulfilled"
          ? appointments.value.filter((item) => item.role === "client")
          : null
      }
      hasProfessionalRole={
        appointments.status === "fulfilled" &&
        appointments.value.some((item) => item.role === "professional")
      }
      preselectedConnectionId={typeof vinculo === "string" ? vinculo : null}
      sessionByAppointment={Object.fromEntries(
        (sessions.status === "fulfilled" ? sessions.value : [])
          .filter((item) => item.role === "client")
          .map((item) => [item.appointmentId, item.id]),
      )}
    />
  );
}
