import "server-only";

import { createAdminClient, type AdminClient } from "@/lib/supabase/admin";
import type { Evidence, VerificationOutcome } from "@/lib/professional/verification-decision";

import type { EmecSnapshotReader } from "./providers/education/emec-snapshot";

/**
 * Executor confiavel da verificacao (ADR-0028) — TERCEIRO e ultimo chamador
 * nominal do cliente `service_role`, ao lado do recovery e do dispatcher.
 *
 * Por que precisa dele: a evidencia e a decisao automatica nao podem ser
 * gravadas pelo cliente do proprio profissional (ele chamaria a RPC direto
 * pelo PostgREST com evidencia forjada). As RPCs `_for` so aceitam
 * `service_role`, e o banco confere a prova de novo antes de aprovar.
 *
 * O que ele NAO faz: ler dado de produto, servir tela, ou gravar qualquer
 * coisa fora destas quatro RPCs/tabelas. Sem a chave, devolve `null` e a
 * verificacao segue pela fila humana (pre-checagem restrita).
 */
export interface TrustedVerificationStore {
  recordEvidence(userId: string, submission: number, evidence: Evidence[], policyVersion: string): Promise<void>;
  applyAutomated(userId: string, submission: number, outcome: Extract<VerificationOutcome, "VERIFIED" | "REJECTED">, policyVersion: string): Promise<string>;
  emecReader(): EmecSnapshotReader;
}

export class TrustedStoreError extends Error {
  constructor(
    public readonly operation: string,
    public readonly code: string | undefined,
  ) {
    super(`trusted_store_${operation}`);
    this.name = "TrustedStoreError";
  }
}

function toRow(item: Evidence, policyVersion: string) {
  return {
    fact_type: item.fact,
    source_type: item.sourceType,
    provider: item.provider,
    status: item.status,
    detail: item.detail ?? null,
    assurance: item.assurance ?? null,
    value_digest: item.valueDigest ?? null,
    confidence: item.confidence ?? null,
    checked_at: item.checkedAt,
    expires_at: item.expiresAt ?? null,
    policy_version: policyVersion,
  };
}

export function createTrustedVerificationStore(client: AdminClient | null = createAdminClient()): TrustedVerificationStore | null {
  if (!client) return null;
  return {
    async recordEvidence(userId, submission, evidence, policyVersion) {
      const { error } = await client.rpc("record_verification_evidence_for", {
        p_professional_user_id: userId,
        p_submission: submission,
        p_items: evidence.map((item) => toRow(item, policyVersion)),
      });
      if (error) throw new TrustedStoreError("record_evidence", error.code);
    },
    async applyAutomated(userId, submission, outcome, policyVersion) {
      const { data, error } = await client.rpc("apply_automated_verification_for", {
        p_professional_user_id: userId,
        p_submission: submission,
        p_outcome: outcome === "VERIFIED" ? "verified" : "rejected",
        p_policy_version: policyVersion,
      });
      if (error) throw new TrustedStoreError("apply_automated", error.code);
      return data as string;
    },
    emecReader() {
      let active: { id: string; source: "emec_open_data" | "qa_fixture" } | null | undefined;
      const current = async () => {
        if (active !== undefined) return active;
        const { data } = await client.from("education_registry_snapshots").select("id,source").eq("active", true).maybeSingle();
        active = data ? { id: data.id, source: data.source as "emec_open_data" | "qa_fixture" } : null;
        return active;
      };
      const snapshot = async () => (await current())?.id ?? null;
      return {
        async activeSource() {
          return (await current())?.source ?? null;
        },
        async findInstitution(normalizedName) {
          const id = await snapshot();
          if (!id) return { found: false, activeCourse: null };
          const { data } = await client
            .from("education_registry_courses")
            .select("course_status")
            .eq("snapshot_id", id)
            .eq("institution_name_normalized", normalizedName)
            .limit(1);
          return { found: Boolean(data?.length), activeCourse: null };
        },
      };
    },
  };
}
