import type { Metadata } from "next";
import { requireVerifiedProfessional } from "@/server/professional-gate";
import { getMyAppointments, getOwnAvailabilityExceptions, getOwnAvailabilityWeek } from "@/server/services/appointment-service";
import { getProfessionalProfile } from "@/server/services/professional-service";
import { getMySessions } from "@/server/services/professional-session-service";
import { civilWeekStart } from "@/lib/scheduling/calendar";
import { localDayKey } from "@/lib/scheduling/format";
import { ProAgendaView } from "./view";

export const metadata: Metadata = { title: "Agenda" };
export const dynamic = "force-dynamic";
export default async function ProAgendaPage() {
  const { supabase, user } = await requireVerifiedProfessional();
  const now = new Date().toISOString();
  const [profile, appointments, sessions, exceptions, publication] = await Promise.allSettled([
    getProfessionalProfile(supabase, user), getMyAppointments(supabase), getMySessions(supabase), getOwnAvailabilityExceptions(supabase, user.id),
    supabase.from("professional_availability_weeks").select("timezone").eq("professional_user_id", user.id).order("published_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const profileValue = profile.status === "fulfilled" ? profile.value : null;
  // An empty published week still retains its timezone. Historical exceptions
  // must not override the professional's most recent publication preference.
  const finite = exceptions.status === "fulfilled" ? exceptions.value.exceptions : [];
  const publishedTimezone = publication.status === "fulfilled" ? publication.value.data?.timezone : null;
  const timezone = finite.find((item) => item.endsOn >= localDayKey(now, item.timezone))?.timezone ?? publishedTimezone ?? finite[0]?.timezone ?? "America/Sao_Paulo";
  const readable = exceptions.status === "fulfilled" && publication.status === "fulfilled" && !publication.value.error;
  const initialWeek = readable ? await getOwnAvailabilityWeek(supabase, { weekStart: civilWeekStart(localDayKey(now, timezone)), timezone }).catch(() => null) : null;
  return <ProAgendaView now={now} hasProfile={profile.status === "rejected" || Boolean(profileValue)} verified={profileValue?.effective_verification_status === "verified"} initialWeek={initialWeek}
    appointments={appointments.status === "fulfilled" ? appointments.value.filter((item) => item.role === "professional") : null}
    sessionByAppointment={Object.fromEntries((sessions.status === "fulfilled" ? sessions.value : []).filter((item) => item.role === "professional").map((item) => [item.appointmentId, item.id]))} />;
}
