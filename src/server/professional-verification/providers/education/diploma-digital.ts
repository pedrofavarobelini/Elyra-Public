import "server-only";

import type { Availability, EducationVerificationProvider, EducationResult } from "../types";

/**
 * Diploma Digital (MEC) — porta. Estado: BLOCKED para verificacao.
 *
 * Verificar exige, separadamente:
 *   STRUCTURE_VALID  — XML contra o XSD oficial do MEC (nao vendorizado:
 *                      o portal do MEC esta fora do alcance deste ambiente);
 *   SIGNATURE_VALID  — XAdES com cadeia ICP-Brasil ate a raiz do ITI (raizes
 *                      nao disponiveis offline); assinatura "consistente com o
 *                      certificado embutido" provaria so integridade, nao
 *                      autenticidade — nao conta;
 *   INSTITUTION_VALID— IES emissora no e-MEC (snapshot local);
 *   HOLDER_MATCH     — nome do diplomado = nome da conta.
 *
 * Sem os dois primeiros, nenhum diploma e dado como autentico. A entrada
 * segura do XML ja existe (`xml-guard.ts`) para quando o XSD e a cadeia forem
 * vendorizados; ate la este provider fica indisponivel.
 */
export const DIPLOMA_DIGITAL_CHECKS = ["STRUCTURE_VALID", "SIGNATURE_VALID", "INSTITUTION_VALID", "HOLDER_MATCH"] as const;

export function createDiplomaDigitalProvider(): EducationVerificationProvider {
  return {
    id: "mec_diploma_digital",
    kind: "education",
    billing: "free",
    sourceType: "official_open_data",
    productionAccepted: true,
    availability(): Availability {
      return { available: false, reason: "UNVERIFIED_CONTRACT" };
    },
    async verify(): Promise<EducationResult> {
      return { status: "NOT_CONFIGURED", detail: "diploma_xsd_and_icp_chain_missing" };
    },
  };
}
