import type { Assurance, EvidenceStatus, SourceType } from "@/lib/professional/verification-decision";

/**
 * Portas de provider (ADR-0028). O dominio pede EVIDENCIA ("registro",
 * "identidade"), nunca um fornecedor. Trocar de fornecedor nao muda gate.
 */

export type Billing = "free" | "paid";
export type ProviderKind = "registry" | "identity" | "education" | "credential" | "document";

export type Unavailability =
  | "DISABLED"
  | "NOT_CONFIGURED"
  | "BUDGET_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "LOCAL_ONLY"
  /** O contrato oficial (endpoint/campos/termos) ainda nao foi verificado. */
  | "UNVERIFIED_CONTRACT";

export type Availability = { available: true } | { available: false; reason: Unavailability };

export interface ProviderDescriptor {
  id: string;
  kind: ProviderKind;
  billing: Billing;
  sourceType: SourceType;
  /** Fixture/demo = false: nunca verificacao real. */
  productionAccepted: boolean;
}

// --- Registro profissional ------------------------------------------------------

export interface RegistryLookupInput {
  council: "CRP";
  region: string;
  number: string;
}

export type RegistryStatus = "ACTIVE" | "INACTIVE" | "NOT_FOUND";

export interface RegistryLookupResult {
  source: SourceType;
  provider: string;
  registryNumber: string;
  region: string;
  /** Nome como a fonte devolveu. Usado so em memoria para comparar; nunca gravado. */
  professionalName: string | null;
  status: RegistryStatus;
  specialty: string | null;
  checkedAt: string;
  confidence: number;
  evidenceLevel: "official_individual" | "third_party" | "fixture";
}

export interface ProfessionalRegistryProvider extends ProviderDescriptor {
  kind: "registry";
  availability(): Availability;
  lookup(input: RegistryLookupInput, signal: AbortSignal): Promise<RegistryLookupResult>;
}

// --- Identidade -------------------------------------------------------------------

export interface IdentityInput {
  userId: string;
  accountName: string;
  declaredTitularity: boolean;
  registration: RegistryLookupInput;
}

export interface IdentityResult {
  status: EvidenceStatus;
  assurance: Assurance;
  detail?: string;
}

export interface IdentityVerificationProvider extends ProviderDescriptor {
  kind: "identity";
  availability(): Availability;
  verify(input: IdentityInput, signal: AbortSignal): Promise<IdentityResult>;
}

// --- Formacao, credenciais, documento (portas) -----------------------------------

export interface EducationInput {
  institution: string;
  title: string;
}

export interface EducationResult {
  status: EvidenceStatus;
  detail: string;
}

export interface EducationVerificationProvider extends ProviderDescriptor {
  kind: "education";
  availability(): Availability;
  verify(input: EducationInput, signal: AbortSignal): Promise<EducationResult>;
}

/** Certificacao extracurricular. Nenhum provider aprovado; declarada por padrao. */
export interface CredentialVerificationProvider extends ProviderDescriptor {
  kind: "credential";
  availability(): Availability;
}

/**
 * Analise de documento enviado. Porta sem implementacao de producao: coleta
 * de documento de identidade continua em HARD STOP (L-316) e nao ha motor de
 * extracao aprovado (stack/PedroCore). Extracao nunca e fonte de verdade.
 */
export interface DocumentAnalysisProvider extends ProviderDescriptor {
  kind: "document";
  availability(): Availability;
}
