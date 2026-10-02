import "server-only";

import {
  NOTIFICATION_KINDS,
  type NotificationKind,
} from "@/lib/contracts/notifications";
import { renderEmailHtml } from "@/server/email/layout";

/**
 * Templates de e-mail de engajamento.
 *
 * ## A regra que governa cada palavra aqui
 *
 * `SENSITIVE_CONTENT_IN_EMAIL = NO_BY_DEFAULT`. O assunto e a previa de um
 * e-mail aparecem em tela bloqueada, relogio de pulso, cliente aberto no
 * trabalho e caixa compartilhada — lugares que a Elyra nao controla e onde
 * outra pessoa le por cima do ombro.
 *
 * Entao o e-mail carrega **o convite**, e nunca o conteudo: nada de anotacao de
 * diario, transcricao, sinal observado, interpretacao da IA, valor de humor ou
 * qualquer coisa compartilhada com profissional. O detalhe fica atras da
 * autenticacao, que e onde ele ja esta.
 *
 * ## E a copy nao cobra
 *
 * Mesma disciplina do 23-A: convite no lugar de divida. "Seu espaco de check-in
 * esta disponivel quando voce quiser" em vez de "voce nao registra ha cinco
 * dias" — ausencia de registro nao e falha de ninguem, e transformar ausencia em
 * cobranca e como um produto de acompanhamento emocional vira pressao.
 */

export interface EmailTemplate {
  subject: string;
  body: string;
  /** Destino interno do convite. Nunca URL externa. */
  path: string;
}

export const EMAIL_TEMPLATES: Record<NotificationKind, EmailTemplate> = {
  checkin_reminder: {
    subject: "Há uma novidade no Elyra",
    body: "Quando quiser, abra seu espaço no Elyra para conferir.",
    path: "/dashboard",
  },
  goal_reminder: {
    subject: "Suas metas estão no Elyra",
    body: "Quando quiser, suas metas continuam disponíveis no Elyra.",
    path: "/metas",
  },
  weekly_digest: {
    subject: "Seu resumo no Elyra está disponível",
    body: "Quando quiser, abra o Elyra para conferir as novidades.",
    path: "/relatorios",
  },
  system_notice: {
    subject: "Um aviso sobre o Elyra",
    body: "Há uma informação sobre o funcionamento do serviço no Elyra.",
    path: "/dashboard",
  },
  // Agenda (PRO-6). Assunto e corpo nao dizem com quem, quando, nem por que: o
  // fato de alguem ter horario com profissional ja e dado sensivel numa tela
  // bloqueada. "Agenda" e o maximo que sai daqui.
  appointment_requested: {
    subject: "Há uma novidade na sua agenda do Elyra",
    body: "Um pedido de horário aguarda resposta. Os detalhes estão no Elyra.",
    path: "/pro/agenda",
  },
  appointment_confirmed: {
    subject: "Há uma novidade na sua agenda do Elyra",
    body: "Um horário foi confirmado. Os detalhes estão no Elyra.",
    path: "/agenda",
  },
  appointment_cancelled: {
    subject: "Há uma novidade na sua agenda do Elyra",
    body: "Um horário foi cancelado. Os detalhes estão no Elyra.",
    path: "/agenda",
  },
  // PRO-7R: lembrete externo generico - nem com quem, nem que tipo de
  // atendimento, nem horario. "Nas proximas 24 horas" e nao "amanha": o aviso
  // materializa em qualquer ponto da janela de 24 h e pode cair no mesmo dia.
  appointment_reminder: {
    subject: "Lembrete da sua agenda do Elyra",
    body: "Você tem um compromisso agendado nas próximas 24 horas na Elyra. Os detalhes estão no Elyra.",
    path: "/agenda",
  },
  // PRO-7/7R. "Sessao" e termo proibido em e-mail (EMAIL_FORBIDDEN_TERMS): o
  // aviso fala de atividade agendada; o "Preparar sessao" fica no app.
  session_ready: {
    subject: "Lembrete da sua agenda do Elyra",
    body: "Sua atividade agendada começa em breve. Os detalhes estão no Elyra.",
    path: "/agenda",
  },
  // Fluxo B. Genericos: nem quem pediu, nem area, nem motivo.
  connection_requested: {
    subject: "Há uma nova solicitação no Elyra",
    body: "Uma nova solicitação aguarda sua resposta. Os detalhes estão no Elyra.",
    path: "/pro/solicitacoes",
  },
  relationship_created: {
    subject: "Há uma novidade no Elyra",
    body: "Uma solicitação sua foi respondida. Os detalhes estão no Elyra.",
    path: "/configuracoes/privacidade",
  },
  professional_verification_update: {
    subject: "Há uma novidade no Elyra",
    body: "Há uma atualização na sua conta. Os detalhes estão no Elyra.",
    path: "/area-profissional",
  },
  // PRO-8. Genericos de proposito: o assunto aparece em tela bloqueada, e
  // "pedido de ajuda" ja e informacao sensivel sobre quem escreveu.
  help_request_received: {
    subject: "Há uma nova mensagem no Elyra",
    body: "Há uma nova mensagem na sua conta. Os detalhes estão no Elyra.",
    path: "/pro/pedidos",
  },
  help_request_updated: {
    subject: "Há uma novidade no Elyra",
    body: "Há uma atualização na sua conta. Os detalhes estão no Elyra.",
    path: "/pedidos",
  },  // L-433. E-mail nasce desligado; se ligado, generico como os demais.
  invite_accepted: {
    subject: "Há uma novidade no Elyra",
    body: "Há uma atualização na sua conta. Os detalhes estão no Elyra.",
    path: "/pro/vinculos",
  },
};

/**
 * Termos que nao podem aparecer em assunto ou corpo.
 *
 * A lista existe para ser **verificada por teste**, e nao para ser lembrada por
 * quem escreve o proximo template. Ela cobre tanto o conteudo sensivel quanto a
 * copy de cobranca — as duas formas de um e-mail sair errado.
 */
export const EMAIL_FORBIDDEN_TERMS = [
  // Conteudo que nunca sai da area autenticada.
  "transcri",
  "diário",
  "diario",
  "humor",
  "humor:",
  "ansiedade",
  "sono",
  "ciclo",
  "sessão",
  "sessao",
  "se sentindo",
  "sintoma",
  "interpretação",
  "interpretacao",
  "sinal",
  "sinais",
  // Cobranca, urgencia e culpa.
  "você não",
  "voce nao",
  "há dias",
  "ha dias",
  "atrasad",
  "sequência",
  "sequencia",
  "não perca",
  "nao perca",
  "urgente",
  "agora mesmo",
] as const;

/**
 * Rodape: por que esta mensagem chegou, e onde desligar.
 *
 * Um e-mail que nao explica a propria chegada parece vazamento — ainda mais num
 * produto de acompanhamento emocional, onde a pessoa se pergunta o que o
 * remetente sabe. A frase diz o minimo e nao revela nada sobre o conteudo.
 */
export const EMAIL_FOOTER =
  "Você recebeu este aviso porque ele está ligado nas suas preferências do Elyra. " +
  "Pode desligá-lo a qualquer momento em Notificações. " +
  "Nenhum dado do seu acompanhamento é enviado por e-mail.";

/**
 * A mensagem pronta para o transporte: texto puro **e** HTML.
 *
 * `body` continua sendo a fonte — o HTML e a mesma copy com a marca em volta.
 * O link e montado a partir de `baseUrl` mais o `path` interno do template;
 * template nunca carrega URL externa, e o `path` e fixo em codigo.
 */
export function renderEmailMessage(
  kind: NotificationKind,
  baseUrl: string,
): { subject: string; body: string; html: string } {
  const template = EMAIL_TEMPLATES[kind];
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, "");
  const url = `${normalizedBaseUrl}${template.path}`;
  const preferencesUrl = `${normalizedBaseUrl}/notificacoes`;
  const paragraphs = template.body.split("\n\n").filter(Boolean);
  return {
    subject: template.subject,
    // O texto puro carrega o endereco, senao quem le em modo texto fica sem o caminho.
    body:
      `${template.body}\n\nAbrir o Elyra: ${url}\n\n${EMAIL_FOOTER}\n` +
      `Gerencie suas preferências: ${preferencesUrl}`,
    html: renderEmailHtml({
      title: template.subject,
      preheader: paragraphs[0],
      paragraphs,
      cta: { label: "Abrir o Elyra", url },
      footer: EMAIL_FOOTER,
      footerLink: {
        label: "Gerenciar notificações",
        url: preferencesUrl,
      },
    }),
  };
}

/** Toda a copy de e-mail, para auditoria por teste. */
export function allEmailCopy(): string {
  return NOTIFICATION_KINDS.map((kind) => {
    const template = EMAIL_TEMPLATES[kind];
    return `${template.subject} ${template.body}`;
  })
    .join(" ")
    .toLowerCase();
}

/**
 * Redefinicao de senha — o unico e-mail transacional que a Elyra monta sozinha
 * (ADR-0022, modo `ELYRA_RECOVERY_DELIVERY=elyra`).
 *
 * ## O que ele carrega
 *
 * O link de confirmacao e o **unico** valor dinamico, e ele e um segredo de uso
 * unico: por isso nunca entra em log, e o template nao recebe mais nada — nem
 * nome, nem e-mail, nem dado da conta. Quem abre o e-mail numa tela bloqueada
 * aprende apenas que alguem pediu para redefinir uma senha da Elyra.
 *
 * ## Prazo
 *
 * `RECOVERY_LINK_VALIDITY` espelha o `otp_expiry` do GoTrue (3600 s em
 * `supabase/config.toml`). O link e de uso unico por construcao do
 * `verifyOtp`; o texto diz isso para que ninguem guarde o e-mail "para depois".
 */
export const RECOVERY_LINK_VALIDITY = "1 hora";

export const RECOVERY_EMAIL_SUBJECT = "Redefina sua senha da Elyra";

export const RECOVERY_EMAIL_FOOTER =
  "Você recebeu esta mensagem porque alguém pediu para redefinir a senha de uma conta da Elyra com este endereço. " +
  "Nenhum dado do seu acompanhamento é enviado por e-mail.";

export function renderRecoveryEmail(confirmUrl: string): {
  subject: string;
  body: string;
  html: string;
} {
  const paragraphs = [
    "Recebemos um pedido para redefinir a senha da sua conta na Elyra.",
    `Para criar uma nova senha, use o botão abaixo. Por segurança, o link vale por ${RECOVERY_LINK_VALIDITY} e só pode ser usado uma vez.`,
    "Se o pedido não foi seu, ignore este e-mail: sua senha atual continua valendo e nada muda na sua conta.",
    "A Elyra nunca pede sua senha por e-mail.",
  ];
  return {
    subject: RECOVERY_EMAIL_SUBJECT,
    body:
      `${paragraphs.join("\n\n")}\n\nCriar uma nova senha: ${confirmUrl}\n\n` +
      RECOVERY_EMAIL_FOOTER,
    html: renderEmailHtml({
      title: RECOVERY_EMAIL_SUBJECT,
      preheader: paragraphs[0],
      paragraphs,
      cta: { label: "Criar uma nova senha", url: confirmUrl },
      footer: RECOVERY_EMAIL_FOOTER,
    }),
  };
}
