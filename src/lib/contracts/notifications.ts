import { z } from "zod";



export const notificationKindSchema = z.enum([
  "checkin_reminder",
  "goal_reminder",
  "weekly_digest",
  "system_notice",

  // parte (ou do proprio relogio, no lembrete), e nunca convite de engajamento.
  "appointment_requested",
  "appointment_confirmed",
  "appointment_cancelled",
  "appointment_reminder",
  // PRO-7: a janela de entrada da sessao profissional abriu.
  "session_ready",
  // Fluxo B: a pessoa pediu acompanhamento (ao profissional) e o profissional
  // aceitou (a pessoa). Nenhum dos dois carrega nome, area ou motivo.
  "connection_requested",
  "relationship_created",
  // F1-F3: mudanca no cadastro/verificacao profissional da propria conta. A
  // copy nunca diz qual (aprovado, recusado, correcao): tela bloqueada nao conta.
  "professional_verification_update",
  // PRO-8: recado ao profissional recebido (profissional) e marcado como respondido
  // (pessoa). Nunca o texto, nunca quem escreveu, nunca a palavra "ajuda" fora
  // da area autenticada (e-mail e tela bloqueada).
  "help_request_received",
  "help_request_updated",
  // L-433: a pessoa aceitou um codigo de convite deste profissional. Sem nome,
  // sem codigo: o detalhe fica em Vinculos, atras do login.
  "invite_accepted",
]);
export type NotificationKind = z.infer<typeof notificationKindSchema>;

export const NOTIFICATION_KINDS = notificationKindSchema.options;

/**
 * Canais de entrega.
 *
 * `email` entrou na extensao do 23-A, com aprovacao propria — e a matriz cobrou
 * a promessa do desenho original: acrescentar um canal foi **uma linha por
 * tipo**, e nao uma migration de colunas.
 *
 * Os tres nao sao equivalentes, e o contrato nao finge que sejam. `in_app`
 * espera a pessoa abrir o aplicativo. `web_push` interrompe o navegador dela.
 * `email` **sai da Elyra** e chega num lugar que nao e nosso — caixa
 * compartilhada, tela bloqueada, relogio de pulso —, e por isso nasce desligado
 * em todos os tipos, sem excecao nem heranca de outro canal.
 */
export const notificationChannelSchema = z.enum([
  "in_app",
  "web_push",
  "email",
]);
export type NotificationChannel = z.infer<typeof notificationChannelSchema>;

export const NOTIFICATION_CHANNELS = notificationChannelSchema.options;

/**
 * Prioridade e propriedade do **tipo**, e nao da preferencia.
 *
 * `routine` nunca interrompe: ela espera a pessoa abrir o aplicativo.
 * `important` pode chegar por push quando a pessoa autorizou aquele canal — e
 * so o aviso de sistema tem esse direito, porque ele fala do servico, e nao do
 * comportamento de quem usa.
 */
export const NOTIFICATION_PRIORITY: Record<
  NotificationKind,
  "routine" | "important"
> = {
  checkin_reminder: "routine",
  goal_reminder: "routine",
  weekly_digest: "routine",
  system_notice: "important",
  appointment_requested: "routine",
  appointment_confirmed: "routine",
  appointment_cancelled: "routine",
  appointment_reminder: "routine",
  session_ready: "routine",
  connection_requested: "routine",
  relationship_created: "routine",
  professional_verification_update: "routine",
  help_request_received: "routine",
  help_request_updated: "routine",
  invite_accepted: "routine",
};

/**
 * Copy fechada.
 *
 * Nenhum texto livre entra na tabela de notificacoes: a copy exibida e derivada
 * daqui pelo `kind`. Isso mantem a auditoria de linguagem **finita** — ha um
 * lugar unico onde uma frase de cobranca poderia nascer, e um teste que o le.
 *
 * O convite substitui a cobranca por construcao: "seus registros estao aqui
 * quando quiser" em vez de "voce nao registra ha cinco dias". A segunda forma
 * transforma ausencia em divida, e ausencia de registro nao e falha de ninguem.
 */
export const NOTIFICATION_COPY: Record<
  NotificationKind,
  { title: string; message: string }
> = {
  checkin_reminder: {
    title: "Lembrete de check-in",
    message: "Reserve um momento para registrar como você está se sentindo.",
  },
  goal_reminder: {
    title: "Lembrete de metas",
    message: "Revise o andamento das suas metas ativas.",
  },
  weekly_digest: {
    title: "Resumo da semana",
    message: "Seus registros da semana estão reunidos quando você quiser ver.",
  },
  system_notice: {
    title: "Aviso da Elyra",
    message: "Há uma informação sobre o funcionamento do serviço.",
  },
  // Agenda: a copy nao carrega nome, horario nem motivo. O detalhe fica na
  // tela autenticada; a notificacao so diz que ha algo para ver.
  appointment_requested: {
    title: "Novo pedido de horário",
    message: "Há um pedido de horário aguardando sua resposta na agenda.",
  },
  appointment_confirmed: {
    title: "Horário confirmado",
    message: "Um horário que você pediu foi confirmado. Os detalhes estão em Sessão com profissional.",
  },
  appointment_cancelled: {
    title: "Horário cancelado",
    message: "Um horário foi cancelado. Os detalhes estão na sua lista de horários.",
  },
  appointment_reminder: {
    title: "Horário nas próximas 24 horas",
    message: "Há um horário confirmado nas próximas 24 horas. Abra o horário para conferir e se preparar.",
  },
  // PRO-7R: aviso perto da janela, com a acao da tela (Preparar sessao).
  session_ready: {
    title: "Sua atividade agendada começa em breve",
    message: "A entrada já está aberta. Abra o horário e use Preparar sessão.",
  },
  connection_requested: {
    title: "Nova solicitação de acompanhamento",
    message: "Alguém pediu acompanhamento com você. A solicitação está na Central de solicitações.",
  },
  relationship_created: {
    title: "Acompanhamento aceito",
    message: "Um profissional aceitou sua solicitação de acompanhamento. Nada é compartilhado até você escolher.",
  },
  professional_verification_update: {
    title: "Atualização do cadastro profissional",
    message: "Há uma atualização sobre o seu cadastro profissional. Os detalhes estão na Área profissional.",
  },
  // Sem prazo e sem urgencia: o aviso nao pede resposta imediata a ninguem.
  help_request_received: {
    title: "Novo recado de uma pessoa acompanhada",
    message: "Há um recado novo em Recados das pessoas. Recados não têm prazo de resposta.",
  },
  help_request_updated: {
    title: "Seu recado foi respondido",
    message: "O profissional marcou seu recado como respondido. Os detalhes estão em Recados ao profissional.",
  },
  invite_accepted: {
    title: "Convite aceito",
    message: "Uma pessoa aceitou seu convite. O vínculo está em Vínculos; nada é compartilhado até ela escolher.",
  },
};

export const NOTIFICATION_CHANNEL_LABEL: Record<NotificationChannel, string> = {
  in_app: "No aplicativo",
  web_push: "Notificação do navegador",
  email: "E-mail",
};

/**
 * O que **nunca** vai por e-mail, em nenhum tipo de aviso.
 *
 * Assunto e previa aparecem em tela bloqueada, relogio e caixa compartilhada —
 * lugares que a Elyra nao controla e onde outra pessoa pode ler por cima do
 * ombro. Por isso o e-mail carrega o **convite**, e o conteudo fica atras da
 * autenticacao.
 *
 * A lista existe para ser verificada por teste, e nao para ser lembrada.
 */
export const EMAIL_FORBIDDEN_CONTENT = [
  "transcricao",
  "diario",
  "interpretacao de IA",
  "sinais observaveis",
  "valor de humor",
  "conteudo emocional",
  "dado clinico",
  "conteudo compartilhado com profissional",
] as const;

export const NOTIFICATION_KIND_LABEL: Record<NotificationKind, string> = {
  checkin_reminder: "Lembrete de check-in",
  goal_reminder: "Lembrete de metas",
  weekly_digest: "Resumo da semana",
  system_notice: "Avisos da Elyra",
  appointment_requested: "Pedidos de horário",
  appointment_confirmed: "Horário confirmado",
  appointment_cancelled: "Horário cancelado",
  appointment_reminder: "Lembrete de horário",
  session_ready: "Sessão aberta",
  connection_requested: "Solicitações de acompanhamento",
  relationship_created: "Acompanhamento aceito",
  professional_verification_update: "Cadastro profissional",
  help_request_received: "Recados recebidos",
  help_request_updated: "Recado respondido",
  invite_accepted: "Convite aceito",
};

export const NOTIFICATION_KIND_DESCRIPTION: Record<NotificationKind, string> = {
  checkin_reminder: "Um convite para registrar como você está se sentindo.",
  goal_reminder: "Um lembrete sobre as metas que você deixou ativas.",
  weekly_digest: "Uma reunião dos seus próprios registros da semana.",
  system_notice: "Mudanças no serviço, privacidade ou disponibilidade.",
  appointment_requested: "Quando alguém que você acompanha pede um horário.",
  appointment_confirmed: "Quando um horário que você pediu é confirmado.",
  appointment_cancelled: "Quando a outra pessoa cancela um horário.",
  appointment_reminder: "Um aviso 24 horas antes de um horário confirmado.",
  session_ready: "Quando a entrada de uma sessão com profissional abre.",
  connection_requested: "Quando alguém pede acompanhamento com você pela descoberta.",
  relationship_created: "Quando um profissional aceita a sua solicitação de acompanhamento.",
  professional_verification_update: "Quando o seu cadastro profissional é recebido ou a verificação muda.",
  help_request_received: "Quando uma pessoa que você acompanha envia um recado.",
  help_request_updated: "Quando o profissional marca um recado seu como respondido.",
  invite_accepted: "Quando uma pessoa aceita um código de convite que você gerou.",
};

export const notificationSchema = z
  .object({
    id: z.string().uuid(),
    kind: notificationKindSchema,
    title: z.string().min(1).max(80),
    message: z.string().min(1).max(180),
    readAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();

export type InAppNotification = z.infer<typeof notificationSchema>;

export const notificationSnapshotSchema = z
  .object({
    notifications: z.array(notificationSchema).max(20),
    unreadCount: z.number().int().min(0),
  })
  .strict();

export type NotificationSnapshot = z.infer<typeof notificationSnapshotSchema>;

export const notificationIdSchema = z.string().uuid("Notificação inválida.");

export const EMPTY_NOTIFICATION_SNAPSHOT: NotificationSnapshot = {
  notifications: [],
  unreadCount: 0,
};

/* -------------------------------------------------------------------------
   Preferencia: a matriz
   ------------------------------------------------------------------------- */

export const notificationPreferenceSchema = z
  .object({
    kind: notificationKindSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean(),
    /**
     * Adiamento com prazo real, e nao "some por cinco minutos".
     *
     * `null` significa sem adiamento. Enquanto a data for futura, o tipo nao e
     * entregue naquele canal — e a tela diz ate quando, porque um silencio sem
     * prazo visivel e indistinguivel de defeito.
     */
    snoozedUntil: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();

export type NotificationPreference = z.infer<
  typeof notificationPreferenceSchema
>;

export const notificationPreferencesSchema = z
  .object({
    preferences: z
      .array(notificationPreferenceSchema)
      .max(NOTIFICATION_KINDS.length * NOTIFICATION_CHANNELS.length),
    /**
     * Canais que esta instalacao consegue entregar de verdade.
     *
     * `web_push` depende de service worker e de chave VAPID no ambiente. Sem
     * elas o canal chega aqui **ausente**, e a tela informa a indisponibilidade
     * em vez de oferecer um controle que nao faz nada.
     */
    availableChannels: z.array(notificationChannelSchema),
  })
  .strict();

export type NotificationPreferences = z.infer<
  typeof notificationPreferencesSchema
>;

/**
 * O vazio honesto.
 *
 * Matriz vazia e **nenhum** canal declarado: quando a leitura falha, a tela nao
 * sabe o que a pessoa escolheu nem o que a instalacao entrega. Preencher
 * `availableChannels` com `in_app` aqui faria a tela afirmar disponibilidade a
 * partir de uma falha — e o aviso de "push indisponivel" apareceria como se
 * fosse fato apurado, quando na verdade nada foi lido.
 */
export const EMPTY_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  preferences: [],
  availableChannels: [],
};

export const notificationPreferenceUpdateSchema = z
  .object({
    kind: notificationKindSchema,
    channel: notificationChannelSchema,
    enabled: z.boolean().optional(),
    /** `null` remove o adiamento; ausente nao mexe nele. */
    snoozedUntil: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .strict()
  .refine(
    (value) => value.enabled !== undefined || value.snoozedUntil !== undefined,
    "Informe o que deve mudar nesta preferência.",
  );

export type NotificationPreferenceUpdate = z.infer<
  typeof notificationPreferenceUpdateSchema
>;

/**
 * Opcoes de adiamento oferecidas na tela.
 *
 * Prazos que uma pessoa reconhece, e nao numeros arbitrarios. O maior e uma
 * semana: adiamento nao substitui desligar, e oferecer "para sempre" disfarcado
 * de snooze esconderia o controle real atras de um eufemismo.
 */
export const SNOOZE_OPTIONS = [
  { id: "one_day", label: "Por 1 dia", days: 1 },
  { id: "one_week", label: "Por 1 semana", days: 7 },
] as const;

export type SnoozeOptionId = (typeof SNOOZE_OPTIONS)[number]["id"];

/** Um adiamento so vale enquanto a data for futura. */
export function isSnoozed(
  preference: Pick<NotificationPreference, "snoozedUntil">,
  now: Date = new Date(),
): boolean {
  if (!preference.snoozedUntil) return false;
  return new Date(preference.snoozedUntil).getTime() > now.getTime();
}

/**
 * A entrega acontece? Uma funcao, e nao a leitura direta do booleano.
 *
 * Entrega exige **tres** condicoes simultaneas: o canal existe nesta
 * instalacao, a pessoa habilitou aquele par, e nao ha adiamento vigente. Com
 * tres condicoes espalhadas pelo codigo, uma delas acaba esquecida em algum
 * caminho — e o caminho esquecido e sempre o que entrega demais.
 */
export function deliversOn(
  preferences: NotificationPreferences,
  kind: NotificationKind,
  channel: NotificationChannel,
  now: Date = new Date(),
): boolean {
  if (!preferences.availableChannels.includes(channel)) return false;
  const match = preferences.preferences.find(
    (item) => item.kind === kind && item.channel === channel,
  );
  if (!match || !match.enabled) return false;
  return !isSnoozed(match, now);
}
