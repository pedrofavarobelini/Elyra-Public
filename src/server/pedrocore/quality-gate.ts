import type {
  ElyraMultimodalInput,
  ElyraMultimodalOutput,
} from "@/lib/contracts/multimodal-signals";
import { coverageNeedsQualification } from "@/lib/contracts/capture-coverage";



export const QUALITY_GATE_FAILURES = [
  "evidence_missing",
  "evidence_unsupported",
  "confidence_missing",
  "confidence_overclaims",
  "coverage_unqualified",
  "clinical_language",
  "causal_language",
] as const;

export type QualityGateFailure = (typeof QUALITY_GATE_FAILURES)[number];

export interface QualityGateResult {
  ok: boolean;
  failures: QualityGateFailure[];
}

/**
 * Vocabulario que nao pode aparecer numa saida exibida.
 *
 * Espelha `tests/non-clinical-language.test.ts`, que ja guarda a copy das telas.
 * A mesma regra vale com mais forca aqui: copy de tela e escrita por gente e
 * revisada uma vez; saida de modelo e gerada a cada sessao.
 */
const CLINICAL_TERMS = [
  "diagnóstico",
  "diagnostico",
  "transtorno",
  "depressão",
  "depressao",
  "bipolar",
  "ansiedade clínica",
  "quadro clínico",
  "sintoma de",
  "indica que você tem",
];

const CAUSAL_TERMS = [
  "causou",
  "por causa de",
  "provocou",
  "faz com que",
  "resultou em",
  "porque você está",
];

/**
 * Palavras que **afirmam** com forca.
 *
 * Com confianca `low`, a saida precisa recuar: "os dados disponiveis nao
 * sustentam" e aceitavel, "voce apresentou" nao e. Isto e o que faz a confianca
 * **alterar a assertividade** em vez de virar um asterisco embaixo de uma frase
 * categorica.
 */
const ASSERTIVE_TERMS = [
  "demonstra",
  "comprova",
  "evidencia que",
  "confirma",
  "claramente",
  "sem dúvida",
  "certamente",
];

function normalize(value: string): string {
  return value.toLowerCase();
}

/**
 * Avalia uma saida contra a projecao que a produziu.
 *
 * Recebe as **duas** pontas de proposito: sem a entrada, nao ha como saber se a
 * observacao aponta para evidencia que existiu. Um gate que so lesse a saida
 * validaria coerencia interna de uma frase inventada.
 */
export function evaluateInterpretationQuality(
  input: ElyraMultimodalInput,
  output: ElyraMultimodalOutput,
): QualityGateResult {
  const failures = new Set<QualityGateFailure>();

  // --- evidencia -----------------------------------------------------------

  if (output.observations.length === 0) {
    failures.add("evidence_missing");
  }

  const signalsPresent = new Set(
    input.session.signals
      .filter((signal) => signal.status !== "not_captured")
      .map((signal) => `signals.${signal.name}`),
  );
  const hasTranscript = input.session.transcript !== null;
  const hasTimeline = input.session.windows.length > 0;
  const hasSelfReport = input.session.selfReport !== null;

  for (const observation of output.observations) {
    const path = observation.evidencePath;
    // Uma observacao que se apoia em evidencia **ausente** e o caso que este
    // gate existe para pegar: a frase pode ser plausivel e continuar falando de
    // algo que nao foi observado nesta sessao.
    if (path.startsWith("signals.") && !signalsPresent.has(path)) {
      failures.add("evidence_unsupported");
    }
    if (path === "transcript" && !hasTranscript) {
      failures.add("evidence_unsupported");
    }
    if (path === "timeline" && !hasTimeline) {
      failures.add("evidence_unsupported");
    }
    if (path === "selfReport" && !hasSelfReport) {
      failures.add("evidence_unsupported");
    }
  }

  // --- confianca -----------------------------------------------------------

  if (!output.confidence) {
    failures.add("confidence_missing");
  }

  const body = normalize(
    [output.summary, ...output.observations.map((item) => item.text)].join(" "),
  );

  if (output.confidence === "low") {
    for (const term of ASSERTIVE_TERMS) {
      if (body.includes(term)) failures.add("confidence_overclaims");
    }
  }

  /*
    Cobertura parcial obriga a saida a **dizer** que e parcial. Uma frase sobre
    movimento derivada de 8 dos 30 minutos de camera e verdadeira e enganosa ao
    mesmo tempo - e a unica correcao possivel e a propria frase carregar a
    ressalva, porque o numero sozinho nao consegue.
  */
  const parcial = input.session.modalityCoverage.filter((coverage) =>
    coverageNeedsQualification(coverage),
  );
  if (parcial.length > 0) {
    const declara =
      body.includes("parte da sessão") ||
      body.includes("parte da sessao") ||
      body.includes("parcial") ||
      body.includes("trecho da sessão") ||
      body.includes("trecho da sessao");
    if (!declara) failures.add("coverage_unqualified");
  }

  /*
    O autorrelato nunca e corrigido pelo sinal, nem o contrario - divergencia
    entre o que a pessoa disse e o que foi medido **nao e erro de percepcao
    dela** (`ADR-0008`).

    Nao ha checagem aqui de proposito: `elyraMultimodalOutputSchema` declara
    `selfReportContradictedBySignal: z.literal(false)`, e o contrato recusa a
    saida antes de ela chegar a este modulo. Repetir a regra em runtime seria
    codigo morto - o compilador, alias, o reprova como comparacao impossivel. A
    garantia e estrutural, e este comentario existe para que ninguem conclua que
    ela foi esquecida.
  */

  // --- linguagem -----------------------------------------------------------

  for (const term of CLINICAL_TERMS) {
    if (body.includes(term)) failures.add("clinical_language");
  }
  for (const term of CAUSAL_TERMS) {
    if (body.includes(term)) failures.add("causal_language");
  }

  return { ok: failures.size === 0, failures: [...failures] };
}
