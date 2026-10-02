import "server-only";


export const PROTECTED_QA_EVIDENCE_IDS: readonly string[] = Object.freeze([
  "44fc2121-2ce5-403d-afb8-461d403fffa7",
  "181cb80f-858f-4de0-ac0c-b6be8e8dd2e4",
  "ce4ac275-b246-4f9f-9b3d-7dbf16a7e061",
  "5254e3dd-028e-4980-8ddc-c5e8de7de81f",
]);

// Preserve both canonical and historical QA accounts, including cascade paths.
export const PROTECTED_QA_OWNER_IDS: readonly string[] = Object.freeze([
  "e55311e4-8035-405b-b996-d2a4087cf63f",
  "4918dbc9-920e-4afd-a5ab-43e7c539fe3b",
]);

export class ProtectedQaEvidenceError extends Error {
  readonly code = "PROTECTED_QA_EVIDENCE";

  constructor() {
    super("Evidência de QA protegida. Use uma fixture descartável para exclusão.");
    this.name = "ProtectedQaEvidenceError";
  }
}

export function assertQaOwnerDeletionAllowed(ownerId: string) {
  if (PROTECTED_QA_OWNER_IDS.includes(ownerId.toLowerCase())) {
    throw new ProtectedQaEvidenceError();
  }
}

export function assertQaEvidenceMutationAllowed(sessionId: string, ownerId?: string) {
  if (PROTECTED_QA_EVIDENCE_IDS.includes(sessionId.toLowerCase())) {
    throw new ProtectedQaEvidenceError();
  }
  if (ownerId) assertQaOwnerDeletionAllowed(ownerId);
}
