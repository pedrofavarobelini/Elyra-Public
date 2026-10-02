import { z } from "zod";



/** Mesma forma exigida pelo `check` de `public.consent_events.purpose`. */
export const consentPurposeSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{2,63}$/, "Finalidade inválida.");

export const consentEventTypeSchema = z.enum(["granted", "revoked"]);
export type ConsentEventType = z.infer<typeof consentEventTypeSchema>;

/**
 * Finalidades que a V1 registra como evento, e o que cada uma autoriza.
 *
 * Vocabulario fechado **para exibicao**, e nao para validacao: o que nao estiver
 * aqui aparece com o proprio identificador tecnico, e nao desaparece.
 */
export const CONSENT_PURPOSE_LABEL: Record<string, string> = {
  terms_privacy: "Termos e privacidade",
  cycle_tracking: "Acompanhamento do ciclo",
  ai_inference: "Interpretação por IA",
  training_data: "Contribuir com o aprendizado da Elyra",
};

export const CONSENT_PURPOSE_DESCRIPTION: Record<string, string> = {
  terms_privacy:
    "A base da sua conta: os termos que você aceitou ao criar o acesso.",
  cycle_tracking:
    "Permite registrar e acompanhar o ciclo. Desligar preserva o que já foi registrado.",
  ai_inference:
    "Permite que a Elyra peça uma leitura da IA sobre o que já foi calculado. Não autoriza treino.",
  training_data:
    "Permite que registros seus, já anonimizados e governados, sejam enviados para treino. É separado da interpretação.",
};

export function consentPurposeLabel(purpose: string): string {
  return CONSENT_PURPOSE_LABEL[purpose] ?? purpose;
}

export const consentEventSchema = z
  .object({
    id: z.string().uuid(),
    purpose: consentPurposeSchema,
    documentVersion: z.string().min(1).max(32),
    eventType: consentEventTypeSchema,
    occurredAt: z.string().datetime({ offset: true }),
    /** Presente somente em revogacao: aponta a concessao que ela encerra. */
    grantedEventId: z.string().uuid().nullable(),
    expiresAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type ConsentEvent = z.infer<typeof consentEventSchema>;

/**
 * Uma finalidade, com a historia dela e o estado que dai decorre.
 *
 * `active` e **derivado** dos eventos, e nao um campo guardado: a mesma regra
 * que o banco usa nas funcoes `*_consent_active`. Guardar o estado ao lado do
 * log criaria duas fontes da verdade que divergem no primeiro erro.
 */
export const consentPurposeHistorySchema = z
  .object({
    purpose: consentPurposeSchema,
    label: z.string().min(1),
    description: z.string().nullable(),
    active: z.boolean(),
    /** Quando a concessao vigente comecou. `null` quando nao ha vigente. */
    activeSince: z.string().datetime({ offset: true }).nullable(),
    /** Versao do documento da concessao vigente, ou da ultima que houve. */
    documentVersion: z.string().nullable(),
    events: z.array(consentEventSchema),
  })
  .strict();

export type ConsentPurposeHistory = z.infer<typeof consentPurposeHistorySchema>;

/**
 * Consentimento que **nao** e evento, e por isso nao aparece no log.
 *
 * A honestidade aqui e o ponto: a pessoa precisa saber que existe autorizacao
 * dela governada em outro lugar, e onde mudar. Uma linha do tempo que mostra
 * quatro finalidades e cala sobre as demais sugere que as demais nao existem.
 */
export const consentElsewhereSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    /** Onde a pessoa muda isso, dentro do proprio produto. */
    whereToChange: z.string().min(1),
  })
  .strict();

export type ConsentElsewhere = z.infer<typeof consentElsewhereSchema>;

export const CONSENT_ELSEWHERE: ConsentElsewhere[] = [
  {
    id: "multimodal_session",
    label: "Câmera, microfone, transcrição e análise da sessão",
    description:
      "Cada sessão congela as próprias autorizações no momento em que é criada. Elas não são herdadas de uma sessão para a outra, e por isso não formam uma linha do tempo única.",
    whereToChange: "Ao preparar cada sessão, em Sessões.",
  },
  {
    id: "professional_sharing",
    label: "Compartilhamento com profissional",
    description:
      "Cada permissão é concedida por categoria de dado, para uma conexão específica, e pode ter janela de tempo própria. A revogação é imediata.",
    whereToChange: "No bloco Compartilhamento com profissional, nesta tela.",
  },
];



/**
 * Estar autenticado **nao** e estar autorizado.
 *
 * Login com Google prova identidade; nao prova que a pessoa aceitou os termos
 * da Elyra. Sao dois contratos diferentes, e a tela de consentimento do Google
 * nao fala pela Elyra. Estas constantes existem para que essa distincao tenha um
 * lugar so no codigo.
 */
export const TERMS_PRIVACY_PURPOSE = "terms_privacy";


export const CURRENT_TERMS_PRIVACY_VERSION = "v1";

/**
 * O guarda pergunta por **concessao vigente**, e nao por igualdade de versao.
 *
 * Gatear por versao criaria, sozinho, uma politica de reaceite: no dia em que a
 * versao mudasse, toda a base ficaria trancada ate reaceitar. Isso e decisao de
 * produto, e nao efeito colateral de uma constante. Enquanto essa decisao nao
 * existir, o contrato e o atual: ha grant vigente de `terms_privacy`, ou nao ha.
 */
export const TERMS_REACCEPTANCE_ON_NEW_VERSION = false;


export const TERMS_DOCUMENTS_AVAILABLE = true;

export const TERMS_CONSENT_REQUIRED_CODE = "TERMS_CONSENT_REQUIRED";

export const TERMS_CONSENT_REQUIRED_MESSAGE =
  "É preciso aceitar os termos e a política de privacidade para continuar.";

export const TERMS_CONTENT_UNAVAILABLE_MESSAGE =
  "Os documentos de termos e privacidade estão em preparação. Enquanto isso, " +
  "não registramos um aceite — seria pedir que você concordasse com um texto " +
  "que ainda não existe.";

/** Onde a pessoa autenticada e sem consentimento vigente e recebida. */
export const FIRST_ACCESS_PATH = "/primeiro-acesso";

/**
 * O desfecho do aceite de primeiro acesso.
 *
 * Vive no contrato, e nao no arquivo da Server Action: um modulo `"use server"`
 * so pode exportar funcoes assincronas, entao o estado inicial nao cabe la — e a
 * tela precisa dele para inicializar `useActionState`.
 *
 * Sucesso nao tem estado: ele termina em redirect.
 */
export type FirstAccessState =
  | { status: "idle" }
  | { status: "error"; message: string };

export const FIRST_ACCESS_INITIAL_STATE: FirstAccessState = { status: "idle" };

/** Ha concessao vigente de `terms_privacy` nesta historia? */
export function hasActiveTermsGrant(history: ConsentHistory): boolean {
  return history.purposes.some(
    (purpose) => purpose.purpose === TERMS_PRIVACY_PURPOSE && purpose.active,
  );
}

export const consentHistorySchema = z
  .object({
    purposes: z.array(consentPurposeHistorySchema),
    elsewhere: z.array(consentElsewhereSchema),
  })
  .strict();

export type ConsentHistory = z.infer<typeof consentHistorySchema>;

export const EMPTY_CONSENT_HISTORY: ConsentHistory = {
  purposes: [],
  elsewhere: CONSENT_ELSEWHERE,
};

/**
 * Deriva a historia por finalidade a partir do log cru.
 *
 * Funcao pura, e testada como tal: e a mesma regra que o PostgreSQL aplica em
 * `ai_inference_consent_active` e `training_consent_active` — vigente e a
 * concessao **sem revogacao correspondente** e ainda dentro da validade.
 *
 * A ordenacao dos eventos e cronologica dentro de cada finalidade, porque a
 * pergunta que a pessoa faz e "o que aconteceu, e em que ordem".
 */
export function buildConsentHistory(
  events: ConsentEvent[],
  now: Date = new Date(),
): ConsentHistory {
  const byPurpose = new Map<string, ConsentEvent[]>();
  for (const event of events) {
    const list = byPurpose.get(event.purpose) ?? [];
    list.push(event);
    byPurpose.set(event.purpose, list);
  }

  const purposes = [...byPurpose.entries()]
    .map(([purpose, list]) => {
      const ordered = [...list].sort((a, b) =>
        a.occurredAt.localeCompare(b.occurredAt),
      );
      const revokedGrantIds = new Set(
        ordered
          .filter((event) => event.eventType === "revoked")
          .map((event) => event.grantedEventId),
      );
      const vigente = [...ordered]
        .reverse()
        .find(
          (event) =>
            event.eventType === "granted" &&
            !revokedGrantIds.has(event.id) &&
            (!event.expiresAt || new Date(event.expiresAt) > now),
        ) ?? null;

      const ultima = [...ordered]
        .reverse()
        .find((event) => event.eventType === "granted") ?? null;

      return {
        purpose,
        label: consentPurposeLabel(purpose),
        description: CONSENT_PURPOSE_DESCRIPTION[purpose] ?? null,
        active: vigente !== null,
        activeSince: vigente?.occurredAt ?? null,
        documentVersion: (vigente ?? ultima)?.documentVersion ?? null,
        events: ordered,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "pt-BR"));

  return consentHistorySchema.parse({
    purposes,
    elsewhere: CONSENT_ELSEWHERE,
  });
}
