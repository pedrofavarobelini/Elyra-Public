import "server-only";

import type { Availability, EducationInput, EducationResult, EducationVerificationProvider } from "../types";

/**
 * e-MEC — dado aberto oficial do MEC, importado como snapshot local (custo
 * zero, sem request por consulta). `scripts/import-emec-snapshot.mjs`.
 *
 * O que prova: que a INSTITUICAO consta do cadastro e-MEC (e, quando casar, o
 * curso e a situacao). O que NAO prova: que esta pessoa concluiu o curso —
 * titularidade do diploma e outra evidencia. Por isso o fato `education`
 * daqui nunca vira "Formacao verificada" no perfil publico.
 *
 * Sem snapshot ativo: `NOT_CONFIGURED` (normal na instalacao nova).
 */
export type EmecSnapshotSource = "emec_open_data" | "qa_fixture";

export interface EmecSnapshotReader {
  /** Fonte do snapshot ativo, ou `null` sem snapshot. */
  activeSource(): Promise<EmecSnapshotSource | null>;
  findInstitution(normalizedName: string): Promise<{ found: boolean; activeCourse: boolean | null }>;
}

export function normalizeInstitutionName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `source` = fonte do snapshot ativo. Snapshot de QA vira evidencia
 * `qa_fixture` (nunca "oficial") e so e usado com fixtures ligadas.
 */
export function createEmecSnapshotProvider(
  reader: EmecSnapshotReader | null,
  source: EmecSnapshotSource | null,
): EducationVerificationProvider {
  const fixture = source === "qa_fixture";
  return {
    id: fixture ? "qa_fixture_emec" : "emec_open_data_snapshot",
    kind: "education",
    billing: "free",
    sourceType: fixture ? "qa_fixture" : "official_open_data",
    productionAccepted: !fixture,
    availability(): Availability {
      return reader && source ? { available: true } : { available: false, reason: "NOT_CONFIGURED" };
    },
    async verify(input: EducationInput): Promise<EducationResult> {
      if (!reader) return { status: "NOT_CONFIGURED", detail: "emec_snapshot_missing" };
      const hit = await reader.findInstitution(normalizeInstitutionName(input.institution));
      if (!hit.found) return { status: "UNKNOWN", detail: "institution_not_matched" };
      return { status: "PASS", detail: "institution_registered" };
    },
  };
}
