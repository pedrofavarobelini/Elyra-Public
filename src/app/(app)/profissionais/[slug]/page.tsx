import { ArrowLeft, BadgeCheck, CalendarDays, FlaskConical } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState } from "@/components/states";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AREA_LABEL,
  DEMO_VERIFICATION_COPY,
  isDemoProfessionalRegistration,
  LANGUAGE_LABEL,
  MODALITY_LABEL,
  registrationLabel,
  type DirectoryArea,
  type DirectoryLanguage,
  type DirectoryModality,
} from "@/lib/contracts/professional-directory";
import { formatDate } from "@/lib/professional/portal";
import { requireConsentedUser } from "@/server/auth";
import {
  DirectoryRateLimitedError,
  getProfessionalDirectoryCredentials,
  getProfessionalDirectoryProfile,
  getDirectoryIdentityVerified,
} from "@/server/services/professional-directory-service";
import { TrustFacts } from "@/components/professional/trust-facts";
import { initialsOf } from "@/components/professional/portal-bits";
import { getDirectoryScheduling } from "@/server/services/appointment-service";
import { getMyConnectionForDirectorySlug } from "@/server/services/professional-service";
import { AccompanimentCard } from "./accompaniment-card";

export const metadata: Metadata = { title: "Perfil profissional" };


export default async function ProfissionalPage({ params }: { params: Promise<{ slug: string }> }) {
  const { supabase, user } = await requireConsentedUser();
  const { slug } = await params;

  let profile: Awaited<ReturnType<typeof getProfessionalDirectoryProfile>> = null;
  try {
    profile = await getProfessionalDirectoryProfile(supabase, user, slug);
  } catch (error) {
    if (!(error instanceof DirectoryRateLimitedError)) throw error;
    return (
      <Card>
        <CardContent>
          <EmptyState size="compact" title="Muitas consultas seguidas" description="Aguarde um minuto e tente de novo." />
        </CardContent>
      </Card>
    );
  }
  if (!profile) notFound();

  // PRO-6: fato de agenda e CTA so com vinculo ativo. Falha aqui nao derruba o perfil.
  const scheduling = await getDirectoryScheduling(supabase, slug).catch(() => null);
  // F6: fatos de formacao/experiencia/certificacao. Falha nao derruba o perfil.
  const credentials = await getProfessionalDirectoryCredentials(supabase, user, slug).then(
    (rows) => ({ rows, available: true }),
    () => ({ rows: [], available: false }),
  );
  // Verificacao V2: "Identidade" so aparece quando conferida por fonte real.
  const identityVerified = await getDirectoryIdentityVerified(supabase, slug);
  // Fluxo B: situacao do meu vinculo com este perfil (qualquer estado).
  const connection = await getMyConnectionForDirectorySlug(supabase, slug).catch(() => null);

  const registration = registrationLabel(profile.council, profile.council_region, profile.registration_number);
  const demo = isDemoProfessionalRegistration(profile.registration_number);
  const place = [profile.city, profile.state].filter(Boolean).join("/");

  return (
    <>
      <Link
        href="/profissionais"
        className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Voltar para a descoberta
      </Link>

      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          <Card>
            <CardContent className="flex flex-col gap-5">
              <div className="flex min-w-0 items-start gap-4">
                <span
                  aria-hidden="true"
                  className="inline-flex size-16 shrink-0 items-center justify-center rounded-pill bg-identity-50 text-lg font-semibold text-identity-700"
                >
                  {initialsOf(profile.display_name)}
                </span>
                <div className="min-w-0">
                  <h1 className="text-2xl font-semibold tracking-tight text-ink">{profile.display_name}</h1>
                  {registration ? (
                    <div className="mt-1 text-sm text-ink-muted">
                      <p className="flex flex-wrap items-center gap-x-1.5">
                        {demo ? (
                          <FlaskConical className="size-4 shrink-0 text-attention" aria-hidden="true" />
                        ) : (
                          <BadgeCheck className="size-4 shrink-0 text-identity-700" aria-hidden="true" />
                        )}
                        {registration}
                        {demo ? <Badge tone="attention">DEMO</Badge> : null}
                        {!demo && profile.verified_at ? <span>· conferido em {formatDate(profile.verified_at)}</span> : null}
                      </p>
                      {demo ? <p data-testid="demo-verification-copy">{DEMO_VERIFICATION_COPY}</p> : null}
                    </div>
                  ) : null}
                  <p className="mt-1 text-sm text-ink-muted">
                    {[profile.specialty, place].filter(Boolean).join(" · ")}
                  </p>
                </div>
              </div>

              <section aria-labelledby="perfil-sobre">
                <h2 id="perfil-sobre" className="text-base font-semibold text-ink">Apresentação</h2>
                <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-ink">
                  {profile.bio ?? "Este perfil ainda não tem apresentação escrita."}
                </p>
              </section>

              <dl className="grid gap-4 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-ink-muted">Áreas declaradas</dt>
                  <dd className="mt-1 text-sm text-ink">
                    {profile.areas.map((area) => AREA_LABEL[area as DirectoryArea] ?? area).join(", ")}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Modalidade</dt>
                  <dd className="mt-1 flex flex-wrap gap-1.5">
                    {profile.modalities.map((modality) => (
                      <Badge key={modality} tone="brand">{MODALITY_LABEL[modality as DirectoryModality] ?? modality}</Badge>
                    ))}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-ink-muted">Idiomas</dt>
                  <dd className="mt-1 text-sm text-ink">
                    {profile.languages.map((language) => LANGUAGE_LABEL[language as DirectoryLanguage] ?? language).join(", ")}
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6">
          <AccompanimentCard
            slug={slug}
            displayName={profile.display_name}
            connectionId={connection?.connectionId ?? null}
            initialStatus={(connection?.status as "pending" | "active" | "paused" | "revoked" | "ended" | undefined) ?? null}
          />
          {scheduling && (scheduling.connectionId || scheduling.hasAvailability) ? (
            <Card data-testid="directory-scheduling">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <CalendarDays className="size-4 text-brand-700" aria-hidden="true" />
                  Agenda
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col items-start gap-3 text-sm leading-6 text-ink-muted">
                {scheduling.connectionId ? (
                  scheduling.hasAvailability ? (
                    // "Pedir horario" fica no cartao de acompanhamento (uma acao, um lugar).
                    <p>Vocês têm vínculo ativo e há horários abertos na agenda.</p>
                  ) : (
                    <p>Vocês têm vínculo ativo, mas ainda não há horários abertos na agenda.</p>
                  )
                ) : (
                  <p>Há horários abertos na agenda para quem já tem vínculo com este perfil.</p>
                )}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      {/*
        F6: bloco factual em largura inteira, abaixo das colunas — ele nao pode
        desequilibrar a apresentacao nem as acoes (guarda de coluna do PRO-5).
      */}
      <div className="mt-5 lg:mt-6">
        <TrustFacts
          registration={registration}
          verifiedAt={profile.verified_at}
          identityVerified={identityVerified}
          demo={demo}
          credentials={credentials.rows}
          credentialsAvailable={credentials.available}
        />
      </div>
    </>
  );
}
