"use client";

import { Check, ChevronLeft } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { CredentialsEditor, type EditableCredential as Credential } from "@/components/professional/credentials-editor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleChips } from "@/components/ui/toggle-chips";
import {
  AREA_LABEL,
  DIRECTORY_AREAS,
  DIRECTORY_LANGUAGES,
  DIRECTORY_MODALITIES,
  LANGUAGE_LABEL,
  MODALITY_LABEL,
  UF_CODES,
} from "@/lib/contracts/professional-directory";
import {
  CREDENTIAL_KIND_FOR_STEP,
  nextOnboardingStep,
  ONBOARDING_STEP_LABEL,
  ONBOARDING_STEPS,
  previousOnboardingStep,
  type CredentialKind,
  type OnboardingStep,
} from "@/lib/contracts/professional-onboarding";
import { PROFESSIONAL_STATE_LABEL, type ProfessionalState } from "@/lib/contracts/professional-state";
import { VERIFICATION_REASON_LABEL } from "@/lib/contracts/professional-verification";
import { cn } from "@/lib/utils";

interface PublicDraft {
  displayName: string | null;
  bio: string | null;
  city: string | null;
  state: string | null;
  modalities: string[];
  areas: string[];
  languages: string[];
}

interface Props {
  step: OnboardingStep;
  state: ProfessionalState;
  accountName: string;
  completed: string[];
  identityConfirmed: boolean;
  registry: { councilRegion: string; registrationNumber: string; specialty: string };
  publicDraft: PublicDraft;
  credentials: Credential[];
  missing: OnboardingStep[];
  lastReason: string | null;
  submittedAt: string | null;
}

const SELECT_CLASS =
  "flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400";

const hrefFor = (step: OnboardingStep) => `/area-profissional/cadastro?etapa=${step}` as Route;

async function send(method: string, url: string, body?: unknown) {
  const response = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return null;
  const payload = (await response.json().catch(() => ({}))) as { data?: unknown; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Não foi possível salvar agora. Tente de novo.");
  return payload.data;
}

/**
 * Cadastro profissional em etapas (F2). A etapa vive na URL e o conteudo no
 * banco: "Salvar e continuar" grava e avanca; "Voltar" nunca apaga nada.
 */
export function OnboardingWizard(props: Props) {
  const { step } = props;
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const index = ONBOARDING_STEPS.indexOf(step);
  const previous = previousOnboardingStep(step);
  const next = nextOnboardingStep(step);

  async function saveAndGo(body: unknown | null, destination: OnboardingStep | null) {
    setBusy(true);
    setError(null);
    try {
      if (body !== null) await send("PUT", "/api/professional/onboarding", body);
      router.push(destination ? hrefFor(destination) : ("/area-profissional" as Route));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível salvar agora.");
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Cadastro profissional"
        description="Uma etapa por vez. Tudo fica salvo: você pode sair e continuar depois."
        action={
          <Button asChild variant="ghost">
            <Link href={"/area-profissional" as Route}>Voltar à área profissional</Link>
          </Button>
        }
      />

      {props.state === "PENDING_CORRECTION" ? (
        <p className="mb-5 rounded-control border border-attention/30 bg-attention-soft px-4 py-3 text-sm text-ink" role="status">
          <span className="font-medium">Correção necessária: </span>
          {(props.lastReason && VERIFICATION_REASON_LABEL[props.lastReason]) ?? "revise as informações"}. Corrija e reenvie na
          etapa Revisão.
        </p>
      ) : props.state === "UNDER_AUTOMATED_REVIEW" ? (
        <p className="mb-5 rounded-control border border-line bg-surface-muted px-4 py-3 text-sm text-ink-muted" role="status">
          Seu cadastro já foi enviado e está em conferência. Alterar região ou número do registro reinicia a conferência.
        </p>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-8">
        <nav aria-label="Etapas do cadastro" className="min-w-0">
          <p className="mb-2 text-sm font-medium text-ink lg:hidden" data-testid="onboarding-progress">
            Etapa {index + 1} de {ONBOARDING_STEPS.length}: {ONBOARDING_STEP_LABEL[step]}
          </p>
          <div className="h-1.5 overflow-hidden rounded-pill bg-surface-muted lg:hidden" aria-hidden="true">
            <div className="h-full rounded-pill bg-brand-500" style={{ width: `${((index + 1) / ONBOARDING_STEPS.length) * 100}%` }} />
          </div>
          <ol className="hidden flex-col gap-1 lg:flex">
            {ONBOARDING_STEPS.map((item, position) => {
              const done = props.completed.includes(item);
              const current = item === step;
              return (
                <li key={item}>
                  <Link
                    href={hrefFor(item)}
                    aria-current={current ? "step" : undefined}
                    className={cn(
                      "flex min-h-10 items-center gap-3 rounded-control px-2.5 text-sm transition-colors",
                      current ? "bg-surface-brand font-medium text-brand-700" : "text-ink-muted hover:bg-surface-muted",
                    )}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-pill border text-xs tabular-nums",
                        done ? "border-transparent bg-brand-500 text-surface" : "border-line bg-surface",
                      )}
                    >
                      {done ? <Check className="size-3.5" /> : position + 1}
                    </span>
                    <span className="flex-1">{ONBOARDING_STEP_LABEL[item]}</span>
                    {done ? <span className="sr-only">(concluída)</span> : null}
                  </Link>
                </li>
              );
            })}
          </ol>
        </nav>

        <Card className="min-w-0" data-testid="onboarding-step" data-step={step}>
          <StepBody
            {...props}
            busy={busy}
            onSave={(body) => saveAndGo(body, next)}
            footer={(submitLabel, disabled) => (
              <div className="mt-6 flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                {previous ? (
                  <Button asChild variant="ghost">
                    <Link href={hrefFor(previous)}>
                      <ChevronLeft className="size-4" aria-hidden="true" />
                      Voltar
                    </Link>
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" disabled={busy || disabled}>
                  {busy ? "Salvando..." : submitLabel}
                </Button>
              </div>
            )}
          />
          {error ? (
            <p role="alert" className="px-5 pb-5 text-sm text-destructive sm:px-6">
              {error}
            </p>
          ) : null}
        </Card>
      </div>
    </>
  );
}

type StepProps = Props & {
  busy: boolean;
  onSave: (body: unknown | null) => void;
  footer: (label: string, disabled?: boolean) => ReactNode;
};

function StepBody(props: StepProps) {
  switch (props.step) {
    case "inicio":
      return <IntroStep {...props} />;
    case "identidade":
      return <IdentityStep {...props} />;
    case "registro":
      return <RegistryStep {...props} />;
    case "formacao":
    case "experiencia":
    case "certificacoes":
      return <CredentialStep {...props} kind={CREDENTIAL_KIND_FOR_STEP[props.step] as CredentialKind} />;
    case "atuacao":
      return <PracticeStep {...props} />;
    case "perfil-publico":
      return <PublicStep {...props} />;
    case "revisao":
      return <ReviewStep {...props} />;
  }
}

function StepHeader({ title, description }: { title: string; description: string }) {
  return (
    <CardHeader>
      <CardTitle as="h2">{title}</CardTitle>
      <CardDescription>{description}</CardDescription>
    </CardHeader>
  );
}

function IntroStep({ onSave, footer }: StepProps) {
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ step: "inicio" });
      }}
    >
      <StepHeader
        title="Antes de começar"
        description="Leva alguns minutos. Só região, número do registro e área de atuação são obrigatórios."
      />
      <CardContent className="flex flex-col gap-4 text-sm text-ink">
        <ul className="flex flex-col gap-2">
          <li>• É a mesma conta da Elyra: mesmo login, senha, Google, passkey e segundo fator.</li>
          <li>• Você informa seu registro no CRP; a conferência é feita na fonte oficial do conselho.</li>
          <li>• Formação, experiência e certificações aparecem como “declaradas” até serem conferidas.</li>
          <li>• O perfil só aparece na descoberta depois da verificação e se você decidir publicar.</li>
        </ul>
        <p className="rounded-control bg-surface-muted px-3.5 py-3 text-ink-muted">
          A Elyra não pede CPF, RG, endereço residencial nem foto de documento.
        </p>
        {footer("Começar")}
      </CardContent>
    </form>
  );
}

function IdentityStep({ accountName, identityConfirmed, onSave, footer }: StepProps) {
  const [confirmed, setConfirmed] = useState(identityConfirmed);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ step: "identidade", data: { confirmed } });
      }}
    >
      <StepHeader
        title="Identidade"
        description="O registro precisa ser seu. A conferência compara o nome da sua conta com o nome no conselho."
      />
      <CardContent className="flex flex-col gap-4">
        <div className="rounded-control border border-line px-4 py-3">
          <p className="text-xs text-ink-muted">Nome na sua conta</p>
          <p className="text-base font-medium text-ink" data-testid="onboarding-account-name">
            {accountName}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Diferente do nome no conselho?{" "}
            <Link className="font-medium text-brand-700 underline-offset-2 hover:underline" href="/perfil">
              Ajuste no Perfil
            </Link>{" "}
            antes de enviar.
          </p>
        </div>
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 size-5 shrink-0 accent-brand-600"
            checked={confirmed}
            disabled={identityConfirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            data-testid="onboarding-identity-confirm"
          />
          <span>
            Confirmo que sou a pessoa titular do registro que vou informar e que as informações do cadastro são verdadeiras.
          </span>
        </label>
        {identityConfirmed ? <p className="text-sm text-positive">Confirmação registrada.</p> : null}
        {footer("Salvar e continuar", !confirmed)}
      </CardContent>
    </form>
  );
}

function RegistryStep({ registry, onSave, footer }: StepProps) {
  const [values, setValues] = useState(registry);
  const set = (key: keyof typeof values) => (event: { target: { value: string } }) =>
    setValues((current) => ({ ...current, [key]: event.target.value }));
  return (
    <form
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        onSave({ step: "registro", data: values });
      }}
    >
      <StepHeader
        title="Registro no conselho"
        description="Região e número como aparecem na sua carteira do CRP. É o que a equipe consulta na fonte oficial."
      />
      <CardContent className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-[8rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-region">Região do CRP</Label>
            <Input
              id="onboarding-region"
              value={values.councilRegion}
              onChange={set("councilRegion")}
              inputMode="numeric"
              pattern="[0-9]{2}"
              maxLength={2}
              placeholder="Ex.: 06"
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-registration">Número do registro</Label>
            <Input
              id="onboarding-registration"
              value={values.registrationNumber}
              onChange={set("registrationNumber")}
              minLength={3}
              maxLength={50}
              placeholder="Ex.: 123456"
              required
            />
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onboarding-specialty">Área de atuação</Label>
          <Input
            id="onboarding-specialty"
            value={values.specialty}
            onChange={set("specialty")}
            minLength={2}
            maxLength={80}
            placeholder="Ex.: Psicologia clínica"
            required
          />
          <p className="text-xs text-ink-muted">Declarada por você. A Elyra não certifica especialidade.</p>
        </div>
        {footer("Salvar e continuar")}
      </CardContent>
    </form>
  );
}

function CredentialStep(props: StepProps & { kind: CredentialKind }) {
  const { kind, onSave, footer, step } = props;
  const [count, setCount] = useState(props.credentials.filter((item) => item.kind === kind).length);
  const [editing, setEditing] = useState(false);
  const descriptions: Record<CredentialKind, string> = {
    education: "Graduação, especializações e pós. Opcional. Aparece como declarada até ser conferida.",
    experience: "Onde e como você atuou. Opcional. Sem avaliações, recomendações ou notas de terceiros.",
    certification: "Certificações com emissor e, se houver, validade. Opcional.",
  };
  return (
    <div>
      <StepHeader title={ONBOARDING_STEP_LABEL[step]} description={descriptions[kind]} />
      <CardContent className="flex flex-col gap-3">
        <CredentialsEditor
          kind={kind}
          initial={props.credentials.filter((item) => item.kind === kind)}
          onChange={(items, isEditing) => {
            setCount(items.length);
            setEditing(isEditing);
          }}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSave({ step });
          }}
        >
          {footer(count ? "Salvar e continuar" : "Pular por agora", editing && count > 0)}
        </form>
      </CardContent>
    </div>
  );
}

function PracticeStep({ publicDraft, onSave, footer }: StepProps) {
  const [areas, setAreas] = useState(publicDraft.areas);
  const [modalities, setModalities] = useState(publicDraft.modalities);
  const [languages, setLanguages] = useState(publicDraft.languages.length ? publicDraft.languages : ["pt"]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ step: "atuacao", data: { areas, modalities, languages } });
      }}
    >
      <StepHeader title="Atuação" description="Temas, formato e idiomas em que você atende. Tudo declarado por você." />
      <CardContent className="flex flex-col gap-5">
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Temas (até 6)</legend>
          <ToggleChips
            name="area"
            options={DIRECTORY_AREAS.map((value) => ({ value, label: AREA_LABEL[value] }))}
            selected={areas}
            onChange={setAreas}
            max={6}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Formato</legend>
          <ToggleChips
            name="modality"
            options={DIRECTORY_MODALITIES.map((value) => ({ value, label: MODALITY_LABEL[value] }))}
            selected={modalities}
            onChange={setModalities}
          />
        </fieldset>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-medium text-ink">Idiomas</legend>
          <ToggleChips
            name="language"
            options={DIRECTORY_LANGUAGES.map((value) => ({ value, label: LANGUAGE_LABEL[value] }))}
            selected={languages}
            onChange={setLanguages}
          />
        </fieldset>
        {footer("Salvar e continuar")}
      </CardContent>
    </form>
  );
}

function PublicStep({ publicDraft, accountName, onSave, footer }: StepProps) {
  const [displayName, setDisplayName] = useState(publicDraft.displayName ?? accountName);
  const [bio, setBio] = useState(publicDraft.bio ?? "");
  const [city, setCity] = useState(publicDraft.city ?? "");
  const [uf, setUf] = useState(publicDraft.state ?? "");
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          step: "perfil-publico",
          data: { displayName, bio, city, state: uf || null },
        });
      }}
    >
      <StepHeader
        title="Perfil público"
        description="Como você aparece na descoberta. Nada é publicado agora: publicar é uma escolha sua, depois da verificação."
      />
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onboarding-display-name">Nome de exibição</Label>
          <Input id="onboarding-display-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={80} />
        </div>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-city">Cidade de atendimento</Label>
            <Input id="onboarding-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={60} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="onboarding-uf">UF</Label>
            <select id="onboarding-uf" value={uf} onChange={(e) => setUf(e.target.value)} className={SELECT_CLASS}>
              <option value="">Escolha</option>
              {UF_CODES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-2 text-xs text-ink-muted">Só a cidade onde você atende. Nunca endereço residencial.</p>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="onboarding-bio">Apresentação (opcional)</Label>
          <textarea
            id="onboarding-bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={600}
            rows={4}
            className="w-full rounded-control border border-line bg-surface px-3 py-2 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400"
          />
          <p className="text-xs text-ink-muted">Sem promessa de resultado, diagnóstico ou comparação com outros profissionais.</p>
        </div>
        {footer("Salvar e continuar")}
      </CardContent>
    </form>
  );
}

function ReviewStep(props: StepProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const canSubmit = props.missing.length === 0;
  const resend = props.submittedAt !== null;

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = (await send("POST", "/api/professional/onboarding")) as { verificationStatus: string };
      setDone(
        result.verificationStatus === "needs_correction"
          ? "Recebemos o envio, mas há algo a corrigir. Veja o motivo na área profissional."
          : "Cadastro enviado. A conferência na fonte oficial está em andamento.",
      );
      router.push("/area-profissional" as Route);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível enviar agora.");
      setBusy(false);
    }
  }

  const byKind = (kind: CredentialKind) => props.credentials.filter((item) => item.kind === kind);
  const rows: Array<{ step: OnboardingStep; value: ReactNode }> = [
    { step: "identidade", value: props.identityConfirmed ? `Confirmada · ${props.accountName}` : "Não confirmada" },
    {
      step: "registro",
      value: props.registry.registrationNumber
        ? `CRP ${props.registry.councilRegion}/${props.registry.registrationNumber} · ${props.registry.specialty}`
        : "Não preenchido",
    },
    { step: "formacao", value: `${byKind("education").length} item(ns) declarados` },
    { step: "experiencia", value: `${byKind("experience").length} item(ns) declarados` },
    { step: "certificacoes", value: `${byKind("certification").length} item(ns) declarados` },
    {
      step: "atuacao",
      value: props.publicDraft.areas.length
        ? props.publicDraft.areas.map((area) => AREA_LABEL[area as keyof typeof AREA_LABEL] ?? area).join(", ")
        : "Não preenchido (opcional)",
    },
    {
      step: "perfil-publico",
      value: props.publicDraft.displayName
        ? `${props.publicDraft.displayName}${props.publicDraft.city ? ` · ${props.publicDraft.city}/${props.publicDraft.state ?? ""}` : ""}`
        : "Não preenchido (opcional)",
    },
  ];

  return (
    <form onSubmit={submit}>
      <StepHeader
        title="Revisão e envio"
        description={`Situação atual: ${PROFESSIONAL_STATE_LABEL[props.state]}. Confira antes de enviar.`}
      />
      <CardContent className="flex flex-col gap-4">
        <dl className="divide-y divide-line rounded-control border border-line" data-testid="onboarding-review">
          {rows.map((row) => {
            const missing = props.missing.includes(row.step);
            return (
              <div key={row.step} className="flex items-start gap-3 px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <dt className="text-xs text-ink-muted">
                    {ONBOARDING_STEP_LABEL[row.step]}
                    {missing ? <span className="ml-1 font-medium text-destructive">· obrigatório</span> : null}
                  </dt>
                  <dd className="mt-0.5 text-sm text-ink">{row.value}</dd>
                </div>
                <Link className="shrink-0 text-sm font-medium text-brand-700 underline-offset-2 hover:underline" href={hrefFor(row.step)}>
                  Editar<span className="sr-only"> {ONBOARDING_STEP_LABEL[row.step]}</span>
                </Link>
              </div>
            );
          })}
        </dl>
        <p className="text-sm text-ink-muted">
          Ao enviar, a Elyra faz uma checagem automática de formato e consistência. A aprovação só acontece depois da
          conferência humana na fonte oficial do conselho — nunca automaticamente.
        </p>
        {done ? (
          <p role="status" className="text-sm text-positive">
            {done}
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
          <Button asChild variant="ghost">
            <Link href={hrefFor("perfil-publico")}>
              <ChevronLeft className="size-4" aria-hidden="true" />
              Voltar
            </Link>
          </Button>
          <Button type="submit" disabled={!canSubmit || busy} data-testid="onboarding-submit">
            {busy ? "Enviando..." : resend ? "Reenviar para verificação" : "Enviar para verificação"}
          </Button>
        </div>
      </CardContent>
    </form>
  );
}
