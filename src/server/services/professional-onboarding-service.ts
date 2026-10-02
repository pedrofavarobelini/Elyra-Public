import "server-only";

import type { SupabaseClient, User } from "@supabase/supabase-js";

import {
  CREDENTIAL_KIND_FOR_STEP,
  credentialInputSchema,
  credentialReviewInputSchema,
  nextOnboardingStep,
  onboardingStepInputSchema,
  ONBOARDING_STEPS,
  publicDraftSchema,
  REQUIRED_ONBOARDING_STEPS,
  type OnboardingStep,
  type PublicDraft,
} from "@/lib/contracts/professional-onboarding";
import { publicProfileInputSchema } from "@/lib/contracts/professional-directory";
import { professionalStateFrom, type ProfessionalState } from "@/lib/contracts/professional-state";
import { VERIFICATION_POLICY_VERSION_V2 } from "@/lib/professional/verification-decision";
import type { Database, Json } from "@/lib/supabase/database.types";
import { findOwnPublicProfile, saveOwnPublicProfile } from "@/server/repositories/professional-directory-repository";
import {
  deleteCredential,
  findOnboarding,
  insertCredential,
  listCredentialQueue,
  listOwnCredentials,
  reviewCredential,
  submitOnboarding,
  updateCredential,
  upsertOnboarding,
} from "@/server/repositories/professional-onboarding-repository";
import { verifySubmission } from "@/server/professional-verification/veltrix-service";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { getMyVerificationHistory, getProfessionalProfile } from "@/server/services/professional-service";

type Client = SupabaseClient<Database>;



export async function getProfessionalArea(client: Client, user: User) {
  const [profile, onboarding, credentials] = await Promise.all([
    getProfessionalProfile(client, user),
    findOnboarding(client, user.id),
    listOwnCredentials(client, user.id),
  ]);
  const state: ProfessionalState = professionalStateFrom({
    effectiveStatus: profile?.effective_verification_status ?? null,
    hasOnboardingDraft: Boolean(onboarding),
  });
  const history = profile
    ? await getMyVerificationHistory(client, user).then(
        (rows) => ({ rows, available: true }),
        () => ({ rows: [], available: false }),
      )
    : { rows: [], available: true };
  return { state, profile, onboarding, credentials, history };
}

export type ProfessionalArea = Awaited<ReturnType<typeof getProfessionalArea>>;

function completedWith(current: readonly string[] | null | undefined, step: OnboardingStep) {
  const set = new Set(current ?? []);
  set.add(step);
  return ONBOARDING_STEPS.filter((item) => set.has(item));
}

function mergeDraft(current: Json | null | undefined, patch: PublicDraft): Json {
  const base = current && typeof current === "object" && !Array.isArray(current) ? current : {};
  return { ...base, ...JSON.parse(JSON.stringify(patch)) } as Json;
}

/** Salva uma etapa e marca como concluida. Retomavel: tudo persiste. */
export async function saveOnboardingStep(client: Client, user: User, raw: unknown) {
  const input = onboardingStepInputSchema.parse(raw);
  const current = await findOnboarding(client, user.id);
  const completed = completedWith(current?.completed_steps, input.step);
  // Retomar leva a proxima etapa: a salva ja esta concluida.
  const base = { current_step: nextOnboardingStep(input.step) ?? input.step, completed_steps: completed };

  switch (input.step) {
    case "identidade":
      // O horario vem do servidor (trigger); o valor enviado so diz "confirmo".
      return upsertOnboarding(client, user.id, { ...base, identity_confirmed_at: new Date().toISOString() });
    case "registro":
      return upsertOnboarding(client, user.id, {
        ...base,
        draft_council_region: input.data.councilRegion,
        draft_registration_number: input.data.registrationNumber,
        draft_specialty: input.data.specialty,
      });
    case "atuacao":
    case "perfil-publico":
      return upsertOnboarding(client, user.id, {
        ...base,
        draft_public_profile: mergeDraft(current?.draft_public_profile, input.data),
      });
    default:
      return upsertOnboarding(client, user.id, base);
  }
}

export function missingForSubmission(onboarding: Awaited<ReturnType<typeof findOnboarding>>): OnboardingStep[] {
  if (!onboarding) return [...REQUIRED_ONBOARDING_STEPS];
  const missing: OnboardingStep[] = [];
  if (!onboarding.identity_confirmed_at) missing.push("identidade");
  if (!onboarding.draft_council_region || !onboarding.draft_registration_number || !onboarding.draft_specialty) {
    missing.push("registro");
  }
  return missing;
}

/**
 * Envio: RPC cria/atualiza o perfil em `pending` → Veltrix V2 coleta evidencia
 * (fontes oficiais gratuitas primeiro; pagas so opcionais), decide pelos gates
 * obrigatorios e executa: VERIFIED/REJECTED so pelo executor confiavel com o
 * banco conferindo a prova; o resto e pre-checagem restrita (correcao ou fila
 * humana). Nada aqui lanca por causa de fonte externa (ADR-0028).
 */
export async function submitProfessionalOnboarding(client: Client, user: User) {
  const onboarding = await findOnboarding(client, user.id);
  const submitted = await submitOnboarding(client);

  let verificationStatus: string = submitted.verification_status;
  if (submitted.verification_status === "pending" && submitted.submission != null) {
    const identity = await getIdentitySnapshot(client, user).catch(() => null);
    const credentials = await listOwnCredentials(client, user.id).catch(() => []);
    const executed = await verifySubmission(client, {
      userId: user.id,
      submission: submitted.submission,
      accountName: identity?.user.name ?? "",
      declaredTitularity: Boolean(onboarding?.identity_confirmed_at),
      region: onboarding?.draft_council_region ?? "",
      registrationNumber: onboarding?.draft_registration_number ?? "",
      education: credentials
        .filter((credential) => credential.kind === "education" && credential.institution)
        .map((credential) => ({ institution: credential.institution ?? "", title: credential.title })),
    });
    verificationStatus = executed.verificationStatus;
  }

  await copyPublicDraft(client, user, onboarding?.draft_public_profile).catch(() => {
    // Perfil publico e opcional para a verificacao; falhar aqui nao desfaz o envio.
  });

  return {
    verificationStatus,
    submission: submitted.submission,
    policyVersion: VERIFICATION_POLICY_VERSION_V2,
  };
}

async function copyPublicDraft(client: Client, user: User, draft: Json | null | undefined) {
  const parsed = publicDraftSchema.safeParse(draft ?? {});
  if (!parsed.success || Object.keys(parsed.data).length === 0) return;
  const existing = await findOwnPublicProfile(client, user.id);
  const merged = {
    // Nunca publica daqui. Quem ja estava listado continua (a descoberta so
    // mostra verificacao vigente de qualquer forma).
    listed: existing?.listed ?? false,
    displayName: parsed.data.displayName ?? existing?.display_name ?? null,
    bio: parsed.data.bio ?? existing?.bio ?? null,
    city: parsed.data.city ?? existing?.city ?? null,
    state: parsed.data.state ?? existing?.state ?? null,
    modalities: parsed.data.modalities ?? existing?.modalities ?? [],
    areas: parsed.data.areas ?? existing?.areas ?? [],
    languages: parsed.data.languages ?? existing?.languages ?? [],
  };
  const valid =
    publicProfileInputSchema.safeParse(merged).data ??
    publicProfileInputSchema.safeParse({ ...merged, listed: false }).data;
  if (valid) await saveOwnPublicProfile(client, user.id, valid);
}

// ---------------------------------------------------------------------------
// Credenciais declaradas
// ---------------------------------------------------------------------------

export class CredentialNotFoundError extends Error {
  constructor() {
    super("credential_not_found");
    this.name = "CredentialNotFoundError";
  }
}

function toRow(input: ReturnType<typeof credentialInputSchema.parse>) {
  return {
    title: input.title,
    institution: input.institution,
    start_year: input.startYear,
    end_year: input.endYear,
    expires_on: input.expiresOn,
  };
}

export async function addCredential(client: Client, user: User, raw: unknown) {
  const input = credentialInputSchema.parse(raw);
  return insertCredential(client, user.id, { kind: input.kind, ...toRow(input) });
}

export async function editCredential(client: Client, id: string, raw: unknown) {
  const input = credentialInputSchema.parse(raw);
  const row = await updateCredential(client, id, toRow(input));
  if (!row) throw new CredentialNotFoundError();
  return row;
}

export async function removeCredential(client: Client, id: string) {
  if (!(await deleteCredential(client, id))) throw new CredentialNotFoundError();
}

/** Reviewer (F5): fila e decisao. Autorizacao e do banco (reviewer ativo + aal2). */
export async function getCredentialQueue(client: Client) {
  return listCredentialQueue(client);
}

export async function decideCredential(client: Client, raw: unknown) {
  const input = credentialReviewInputSchema.parse(raw);
  await reviewCredential(client, {
    credentialId: input.credentialId,
    verified: input.verified,
    source: input.source ?? null,
    evidenceDigest: input.evidenceDigest ?? null,
  });
  return { credentialId: input.credentialId, verified: input.verified };
}

export { CREDENTIAL_KIND_FOR_STEP };
