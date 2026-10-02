import type { Metadata } from "next";

import { PageHeader } from "@/components/journey/page-header";
import { SessionsHub, type NextProfessionalSession } from "@/components/sessions/sessions-hub";
import { requireConsentedUser } from "@/server/auth";
import { getMyAppointments, getMySchedulingProfessionals } from "@/server/services/appointment-service";
import { getMySessions } from "@/server/services/professional-session-service";
import { SessionsView } from "./view";

export const metadata: Metadata = { title: "Sessões" };
export const dynamic = "force-dynamic";

/**
 * Sessoes (ADR-0029): entrada unificada. O registro multimodal particular
 * continua inteiro logo abaixo (mesmo componente, sem mudanca interna); a
 * sessao com profissional reaproveita agenda (PRO-6), sessao (PRO-7) e chamada
 * (PRO-7R) em /agenda. Nenhum segundo sistema.
 */
export default async function SessoesPage() {
  const { supabase } = await requireConsentedUser();
  const [professionals, appointments, sessions] = await Promise.allSettled([
    getMySchedulingProfessionals(supabase),
    getMyAppointments(supabase),
    getMySessions(supabase),
  ]);
  const now = new Date();
  const available = professionals.status === "fulfilled" && appointments.status === "fulfilled";

  const liveSessions =
    sessions.status === "fulfilled"
      ? sessions.value.filter(
          (item) =>
            item.role === "client" &&
            ["scheduled", "ready", "active"].includes(item.status) &&
            Date.parse(item.closesAt) > now.getTime(),
        )
      : [];
  const sessionByAppointment = new Map(liveSessions.map((item) => [item.appointmentId, item]));
  const upcoming =
    appointments.status === "fulfilled"
      ? appointments.value
          .filter((item) => item.role === "client" && item.status === "confirmed" && Date.parse(item.endsAt) > now.getTime())
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      : [];
  const first = upcoming[0];
  const session = first ? sessionByAppointment.get(first.id) : undefined;
  const next: NextProfessionalSession | null = first
    ? {
        sessionId: session?.id ?? null,
        professionalName: first.counterpartName,
        startsAt: first.startsAt,
        opensAt: session?.opensAt ?? null,
        modality: first.modality,
        timezone: first.timezone,
      }
    : null;

  return (
    <>
      <PageHeader
        title="Sessões"
        description="Uma sessão particular é um registro seu. Uma sessão com profissional é uma chamada com quem acompanha você."
      />
      <SessionsHub
        now={now.toISOString()}
        hasProfessional={professionals.status === "fulfilled" && professionals.value.length > 0}
        next={next}
        professionalAvailable={available}
      />
      <section id="particular" aria-label="Sessões particulares" className="mt-8 scroll-mt-24 lg:mt-10">
        <SessionsView embedded />
      </section>
    </>
  );
}
