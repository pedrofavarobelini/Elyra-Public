import "server-only";

import type { Availability, DocumentAnalysisProvider } from "../types";

/**
 * Analise de documento enviado (Veltrix Document Analysis) — porta SEM motor.
 *
 * BLOCKED por tres razoes independentes, todas registradas (L-316):
 * 1. coleta de documento de identidade e dado pessoal novo: base legal,
 *    retencao e descarte precisam de aval juridico, nao so de produto;
 * 2. nao ha motor de extracao aprovado: OCR local e dependencia nova de stack
 *    (ADR), e extracao por LLM passaria pelo PedroCore com contrato que nao
 *    existe — e mandaria documento de identidade a um modelo externo;
 * 3. extracao nunca e fonte de verdade: mesmo com motor, o maximo seria
 *    `IDENTITY_DOCUMENT_CROSSCHECKED`, nunca "parece verdadeiro".
 */
export function createDocumentAnalysisProvider(): DocumentAnalysisProvider {
  return {
    id: "veltrix_document_analysis",
    kind: "document",
    billing: "free",
    sourceType: "local_evidence",
    productionAccepted: false,
    availability(): Availability {
      return { available: false, reason: "UNVERIFIED_CONTRACT" };
    },
  };
}
