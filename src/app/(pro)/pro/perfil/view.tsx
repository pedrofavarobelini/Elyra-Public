"use client";

import { ShieldAlert, ShieldCheck } from "lucide-react";
import { useState, type FormEvent } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  VERIFICATION_DESCRIPTION,
  VERIFICATION_LABEL,
  VERIFICATION_NEXT_STEP,
  VERIFICATION_REASON_LABEL,
  type VerificationStatus,
} from "@/lib/contracts/professional-verification";
import { formatDate, formatDateTime } from "@/lib/professional/portal";
import { CredentialsEditor, type EditableCredential } from "@/components/professional/credentials-editor";
import { PublicProfileEditor, type PublicProfileState } from "./public-profile-editor";
import { InlineEmpty } from "@/components/states";

interface Profile {
  user_id: string;
  council: string;
  council_region: string | null;
  registration_number: string;
  specialty: string;
  verification_status: string;
  /** Calculado no servidor: `verified` vencido ja chega como `expired_review`. */
  effective_verification_status: VerificationStatus;
  verification_reviewed_at: string | null;
  verification_review_due_at: string | null;
  created_at: string;
  updated_at: string;
}

interface HistoryEvent {
  id: string;
  from_status: string | null;
  to_status: string;
  reason_code: string;
  source: string;
  actor_role: string;
  review_due_at: string | null;
  occurred_at: string;
}


export function ProfessionalProfileView({
  initialProfile,
  history,
  historyAvailable,
  publicProfile,
  credentials,
  credentialsAvailable,
}: {
  initialProfile: Profile | null;
  history: HistoryEvent[];
  historyAvailable: boolean;
  publicProfile: PublicProfileState | null;
  credentials: EditableCredential[];
  credentialsAvailable: boolean;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [registrationNumber, setRegistrationNumber] = useState(
    initialProfile?.registration_number ?? "",
  );
  const [specialty, setSpecialty] = useState(initialProfile?.specialty ?? "");
  const [councilRegion, setCouncilRegion] = useState(initialProfile?.council_region ?? "");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const status: VerificationStatus = profile?.effective_verification_status ?? "pending";
  const locked = status === "suspended";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/professional/profile", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ councilRegion, registrationNumber, specialty }),
      });
      const payload = (await response.json()) as { data?: Profile; error?: string };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Não foi possível salvar o registro.");
      }
      setProfile(payload.data);
      setMessage({ tone: "ok", text: "Registro salvo." });
    } catch (caught) {
      setMessage({
        tone: "error",
        text: caught instanceof Error ? caught.message : "Não foi possível salvar o registro.",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Perfil profissional"
        description="Seu registro no conselho, a conferência feita pela Elyra e o que aparece na descoberta."
      />

      <h2 className="mb-3 text-lg font-semibold tracking-tight text-ink">Registro e verificação</h2>
      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]" data-layout="columns">
        <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="main">
          <Card variant="hero" id="verificacao" className="scroll-mt-20 overflow-hidden" data-testid="verification-card">
            <div className="bg-gradient-to-br from-identity-50 via-surface to-brand-50 p-5 sm:p-6">
              <div className="flex flex-wrap items-center gap-3">
                {status === "verified" ? (
                  <ShieldCheck className="size-6 text-identity-600" aria-hidden="true" />
                ) : (
                  <ShieldAlert className="size-6 text-attention" aria-hidden="true" />
                )}
                <h3 className="text-lg font-semibold tracking-tight text-ink">
                  {profile ? VERIFICATION_LABEL[status] : "Registro ainda não cadastrado"}
                </h3>
                {profile ? (
                  <Badge tone={status === "verified" ? "positive" : "attention"} data-verification-status={status}>
                    {profile.council}-{profile.council_region ?? "--"} {profile.registration_number}
                  </Badge>
                ) : null}
              </div>
              <p className="mt-2 max-w-prose text-sm text-ink-muted" data-testid="verification-description">
                {profile
                  ? VERIFICATION_DESCRIPTION[status]
                  : "Cadastre região e número do seu registro no CRP. Uma pessoa confere na fonte oficial do conselho antes de qualquer acesso."}
              </p>
              {profile ? (
                <dl className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-control bg-surface/80 px-3.5 py-3">
                    <dt className="text-xs text-ink-muted">Próximo passo</dt>
                    <dd className="mt-0.5 text-sm font-medium text-ink">{VERIFICATION_NEXT_STEP[status]}</dd>
                  </div>
                  <div className="rounded-control bg-surface/80 px-3.5 py-3">
                    <dt className="text-xs text-ink-muted">Validade da conferência</dt>
                    <dd className="mt-0.5 text-sm font-medium text-ink">
                      {status === "verified" && profile.verification_review_due_at
                        ? `Até ${formatDate(profile.verification_review_due_at)}`
                        : profile.verification_reviewed_at
                          ? `Última conferência em ${formatDate(profile.verification_reviewed_at)}`
                          : "Ainda não conferido"}
                    </dd>
                  </div>
                </dl>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle as="h3">Histórico da verificação</CardTitle>
              <CardDescription>
                O que mudou e por quê. A identidade de quem revisou não aparece aqui.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!historyAvailable ? (
                <BlockError what="o histórico da verificação" />
              ) : history.length === 0 ? (
                <InlineEmpty>Nenhum evento ainda.</InlineEmpty>
              ) : (
                <ol className="flex flex-col gap-3" data-testid="verification-history">
                  {history.map((event) => (
                    <li key={event.id} className="flex gap-3">
                      <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 rounded-pill bg-identity-500" />
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-ink">
                          {VERIFICATION_LABEL[event.to_status as VerificationStatus] ?? event.to_status}
                        </p>
                        <p className="text-xs text-ink-muted">
                          {VERIFICATION_REASON_LABEL[event.reason_code] ?? "Mudança registrada"} ·{" "}
                          <time dateTime={event.occurred_at}>{formatDateTime(event.occurred_at)}</time>
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-5 lg:gap-6" data-layout-column="side">
          <Card>
            <CardHeader>
              <CardTitle as="h3">Dados do registro</CardTitle>
              <CardDescription>
                Trocar região ou número reinicia a conferência. A área de atuação é declarada por você.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={submit}>
                <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="professional-council-region">Região do CRP</Label>
                    <Input
                      id="professional-council-region"
                      value={councilRegion}
                      onChange={(event) => setCouncilRegion(event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]{2}"
                      maxLength={2}
                      placeholder="06"
                      required
                      disabled={locked}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="professional-registration">Número do registro</Label>
                    <Input
                      id="professional-registration"
                      value={registrationNumber}
                      onChange={(event) => setRegistrationNumber(event.target.value)}
                      minLength={3}
                      maxLength={50}
                      required
                      disabled={locked}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="professional-specialty">Área de atuação</Label>
                  <Input
                    id="professional-specialty"
                    value={specialty}
                    onChange={(event) => setSpecialty(event.target.value)}
                    minLength={2}
                    maxLength={80}
                    required
                  />
                </div>
                {locked ? (
                  <p className="text-sm text-ink-muted">
                    Com a verificação suspensa, região e número ficam bloqueados. A área de atuação continua editável.
                  </p>
                ) : null}
                {message ? (
                  <p
                    role={message.tone === "error" ? "alert" : "status"}
                    className={message.tone === "error" ? "text-sm text-destructive" : "text-sm text-positive"}
                  >
                    {message.text}
                  </p>
                ) : null}
                <Button className="self-start" disabled={busy} type="submit">
                  {busy ? "Salvando..." : profile ? "Salvar registro" : "Cadastrar registro"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>

      <section id="credenciais" aria-labelledby="credenciais-titulo" className="mt-5 scroll-mt-20 lg:mt-6" data-testid="professional-credentials">
        <h2 id="credenciais-titulo" className="mb-3 text-lg font-semibold tracking-tight text-ink">
          Formação, experiência e certificações
        </h2>
        {credentialsAvailable ? (
          <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-3">
            {(
              [
                ["education", "Formação"],
                ["experience", "Experiência"],
                ["certification", "Certificações"],
              ] as const
            ).map(([kind, title]) => (
              <Card key={kind}>
                <CardHeader>
                  <CardTitle as="h3">{title}</CardTitle>
                  <CardDescription>Declarado por você até a Elyra conferir. Nunca nota ou recomendação.</CardDescription>
                </CardHeader>
                <CardContent>
                  <CredentialsEditor kind={kind} initial={credentials.filter((item) => item.kind === kind)} />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <BlockError what="formação, experiência e certificações" />
        )}
      </section>

      {profile && publicProfile ? (
        <PublicProfileEditor
          initial={publicProfile}
          verification={status}
          registration={{
            council: profile.council,
            region: profile.council_region,
            number: profile.registration_number,
            reviewedAt: profile.verification_reviewed_at,
          }}
        />
      ) : profile ? (
        <p className="mt-5 text-sm text-ink-muted">O perfil público está indisponível agora.</p>
      ) : null}
    </>
  );
}
