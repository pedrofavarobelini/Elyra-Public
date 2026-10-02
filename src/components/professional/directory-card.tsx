import { BadgeCheck, ChevronRight, FlaskConical, Languages, MapPin } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
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
import { cn } from "@/lib/utils";

import { initialsOf } from "./portal-bits";

export interface DirectoryCardData {
  slug: string | null;
  display_name: string | null;
  council: string | null;
  council_region: string | null;
  registration_number: string | null;
  verified_at: string | null;
  city: string | null;
  state: string | null;
  modalities: string[];
  areas: string[];
  languages: string[];
}


export function DirectoryCard({ profile, preview = false }: { profile: DirectoryCardData; preview?: boolean }) {
  const registration = registrationLabel(profile.council, profile.council_region, profile.registration_number);
  const demo = isDemoProfessionalRegistration(profile.registration_number);
  const place = [profile.city, profile.state].filter(Boolean).join("/");
  const Title = preview ? "p" : "h2";

  return (
    <article
      className={cn(
        "flex h-full flex-col gap-4 rounded-card border border-line bg-surface p-5 shadow-card",
        !preview && "transition-colors hover:border-brand-200",
      )}
      data-testid="directory-card"
    >
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="inline-flex size-12 shrink-0 items-center justify-center rounded-pill bg-identity-50 text-sm font-semibold text-identity-700"
        >
          {initialsOf(profile.display_name)}
        </span>
        <div className="min-w-0">
          <Title className="truncate text-base font-semibold text-ink">{profile.display_name ?? "Nome de exibição"}</Title>
          {registration ? (
            <div className="mt-0.5 text-sm text-ink-muted">
              <p className="flex flex-wrap items-center gap-x-1.5">
                {demo ? (
                  <FlaskConical className="size-4 shrink-0 text-attention" aria-hidden="true" />
                ) : (
                  <BadgeCheck className="size-4 shrink-0 text-identity-700" aria-hidden="true" />
                )}
                <span>{registration}</span>
                {demo ? <Badge tone="attention">DEMO</Badge> : null}
                {!demo && profile.verified_at ? <span>· conferido em {formatDate(profile.verified_at)}</span> : null}
              </p>
              {demo ? <p data-testid="demo-verification-copy">{DEMO_VERIFICATION_COPY}</p> : null}
            </div>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-2 text-sm">
        {place ? (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Local</dt>
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <dd className="text-ink">{place}</dd>
          </div>
        ) : null}
        {profile.languages.length > 0 ? (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Idiomas</dt>
            <Languages className="mt-0.5 size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
            <dd className="text-ink">
              {profile.languages.map((language) => LANGUAGE_LABEL[language as DirectoryLanguage] ?? language).join(", ")}
            </dd>
          </div>
        ) : null}
        {profile.modalities.length > 0 ? (
          <div>
            <dt className="sr-only">Modalidade</dt>
            <dd className="flex flex-wrap gap-1.5">
              {profile.modalities.map((modality) => (
                <Badge key={modality} tone="brand">
                  {MODALITY_LABEL[modality as DirectoryModality] ?? modality}
                </Badge>
              ))}
            </dd>
          </div>
        ) : null}
        {profile.areas.length > 0 ? (
          <div>
            <dt className="text-xs text-ink-muted">Áreas declaradas</dt>
            <dd className="mt-0.5 text-ink">
              {profile.areas.map((area) => AREA_LABEL[area as DirectoryArea] ?? area).join(", ")}
            </dd>
          </div>
        ) : null}
      </dl>

      {!preview && profile.slug ? (
        <Link
          href={`/profissionais/${profile.slug}`}
          className="mt-auto inline-flex min-h-11 items-center gap-1 self-start rounded-control text-sm font-medium text-brand-700 hover:underline"
        >
          Ver perfil
          <ChevronRight className="size-4" aria-hidden="true" />
          <span className="sr-only">de {profile.display_name}</span>
        </Link>
      ) : null}
    </article>
  );
}
