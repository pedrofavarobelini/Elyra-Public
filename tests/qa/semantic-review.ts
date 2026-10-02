

export const SEMANTIC_ERROR_KINDS = [
  /** A transcricao perdeu ou inverteu uma negacao. O erro mais grave da lista. */
  "lost_negation",
  /** Um numero virou outro numero. */
  "changed_number",
  /** Palavra que ninguem falou apareceu no texto. */
  "added_word",
  /** Um nome proprio virou outro. */
  "changed_name",
  /** Um trecho inteiro foi inventado, sem fala correspondente. */
  "fabricated_phrase",
  /** Um trecho falado desapareceu da transcricao. */
  "omitted_span",
] as const;
export type SemanticErrorKind = (typeof SEMANTIC_ERROR_KINDS)[number];

export const SEMANTIC_ERROR_LABEL: Record<SemanticErrorKind, string> = {
  lost_negation: "Negação perdida ou invertida",
  changed_number: "Número trocado",
  added_word: "Palavra acrescentada",
  changed_name: "Nome trocado",
  fabricated_phrase: "Trecho inventado",
  omitted_span: "Trecho omitido",
};


export interface SemanticErrorObservation {
  kind: SemanticErrorKind;
  /** O que a referencia dizia. */
  reference: string;
  /** O que a transcricao disse no lugar. */
  candidate: string;
  note?: string;
}

export interface SemanticReview {
  fixtureId: string;
  reviewer: string;
  reviewedAt: string;
  observations: SemanticErrorObservation[];
}

/**
 * Erros que, se presentes, impedem homologacao independentemente do WER.
 *
 * Fabricacao e negacao perdida nao sao "erro um pouco maior": a primeira coloca
 * na boca da pessoa algo que ela nao disse, e a segunda inverte o que ela
 * disse. Nenhuma taxa boa compensa qualquer uma das duas — `ABSENCE >
 * FABRICATION`.
 */
export const BLOCKING_SEMANTIC_ERRORS: readonly SemanticErrorKind[] = [
  "lost_negation",
  "fabricated_phrase",
];

export function countByKind(
  review: SemanticReview,
): Record<SemanticErrorKind, number> {
  const counts = Object.fromEntries(
    SEMANTIC_ERROR_KINDS.map((kind) => [kind, 0]),
  ) as Record<SemanticErrorKind, number>;
  for (const observation of review.observations) counts[observation.kind] += 1;
  return counts;
}

export function hasBlockingError(review: SemanticReview): boolean {
  return review.observations.some((observation) =>
    BLOCKING_SEMANTIC_ERRORS.includes(observation.kind),
  );
}
