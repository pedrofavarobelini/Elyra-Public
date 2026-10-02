import { z } from "zod";

import { displayNameSchema } from "@/lib/contracts/identity";

const emailSchema = z
  .string()
  .trim()
  .email("Informe um e-mail válido.")
  .max(254);
const passwordSchema = z
  .string()
  .min(8, "A senha deve ter pelo menos 8 caracteres.")
  .max(128)
  .regex(/[A-Za-z]/, "A senha deve conter uma letra.")
  .regex(/[0-9]/, "A senha deve conter um número.");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Informe sua senha.").max(128),
});

export const signupSchema = z.object({
  displayName: displayNameSchema,
  email: emailSchema,
  password: passwordSchema,
  acceptedTerms: z.literal(true, {
    errorMap: () => ({ message: "Aceite os termos e a politica de privacidade." }),
  }),
});

/**
 * O que a pessoa digitou e que deve sobreviver a um erro.
 *
 * `VR-007`: com `<form action>`, o React reseta os campos nao controlados
 * quando a acao termina. Numa acao que **redireciona** isso e irrelevante - a
 * tela some. Numa acao que **volta com erro**, apaga o que a pessoa acabou de
 * digitar, e ela redigita o e-mail inteiro mesmo quando o e-mail estava certo.
 *
 * A senha **nao** entra aqui, e a omissao e deliberada: devolve-la ao cliente
 * a colocaria no payload da resposta e no estado do React sem nenhum ganho -
 * quem errou a senha vai digitar outra de qualquer forma.
 */
export interface AuthFormValues {
  email?: string;
  displayName?: string;
}


export const AUTH_STATUSES = ["idle", "error", "pending_confirmation"] as const;
export type AuthStatus = (typeof AUTH_STATUSES)[number];

export type AuthActionState =
  | { status: "idle" }
  | {
      status: "error";
      message: string;
      /**
       * A tela deve oferecer o caminho de entrar?
       *
       * `true` na resposta generica de cadastro, tanto para conta existente
       * quanto para falha desconhecida. Erros de validacao e rate limit usam
       * `false`, assim como o login. A presenca do link nao distingue os
       * motivos que a resposta generica deliberadamente colapsa.
       */
      offerSignIn: boolean;
      values?: AuthFormValues;
    }
  | { status: "pending_confirmation"; message: string }

  | { status: "mfa_required"; next: string }
  /**
   * Senha aceita e sessao aberta: falta apenas ir para a area autenticada.
   *
   * Mesmo motivo do `mfa_required`, e o mesmo defeito medido do outro lado
   * (`L-176`): quando a Server Action fazia `redirect("/dashboard")`, a
   * requisicao que saia dela chegava **sem** a sessao legivel e o portao
   * devolvia a pessoa para `/entrar` — sem mensagem nenhuma, como se a senha
   * estivesse errada. Quem navega e o cliente, com os cookies ja assentados.
   */
  | { status: "authenticated"; next: string };

export const AUTH_INITIAL_STATE: AuthActionState = { status: "idle" };

/**
 * A frase que responde a tentativa de cadastro que nao concluiu.
 *
 * Ela **nao** confirma nem nega que o e-mail tenha conta. Diz o que fazer nos
 * dois casos, porque quem esta na tela precisa de um proximo passo - e o
 * proximo passo e o mesmo tendo conta ou nao: tente entrar, ou confira os
 * dados.
 */
export const SIGNUP_UNAVAILABLE_MESSAGE =
  "Não foi possível concluir o cadastro. Se você já tem uma conta, entre. " +
  "Caso contrário, confira os dados e tente novamente.";

/** Conta criada, faltando a confirmacao por e-mail para acessar. */
export const SIGNUP_PENDING_CONFIRMATION_MESSAGE =
  "Conta criada. Verifique seu e-mail para concluir o acesso.";



/**
 * Tipos proprios, e nao um estado novo em `AuthActionState`.
 *
 * Aquela uniao e consumida pelo formulario de login/cadastro, que trata
 * `error` e `pending_confirmation` explicitamente. Um estado novo que aquele
 * componente nao conhece renderizaria **silencio** na tela — o pior desfecho
 * possivel num fluxo de autenticacao. Recuperar e redefinir tem telas proprias,
 * entao ganham contratos proprios.
 */

export const recoveryRequestSchema = z.object({ email: emailSchema });

export type RecoveryActionState =
  | { status: "idle" }
  | { status: "sent"; message: string }
  | { status: "error"; message: string; values?: AuthFormValues };

export const RECOVERY_INITIAL_STATE: RecoveryActionState = { status: "idle" };

/**
 * A resposta que **nao** revela se o e-mail tem conta.
 *
 * Mesma regra que governa `/cadastro`: se a tela dissesse "enviamos" para conta
 * existente e "e-mail nao encontrado" para o resto, o formulario viraria uma
 * ferramenta de enumeracao — melhor que a de cadastro, inclusive, porque nao
 * exige senha nenhuma.
 *
 * A frase e deliberadamente condicional ("se houver uma conta"): ela e honesta
 * nos dois casos, e nao promete uma entrega que talvez nao aconteca.
 */
export const RECOVERY_REQUESTED_MESSAGE =
  "Se houver uma conta com esse e-mail, enviamos um link para redefinir a senha. " +
  "Confira a caixa de entrada e o spam.";

export const passwordResetSchema = z
  .object({
    password: passwordSchema,
    /*
      Confirmacao existe porque o campo e mascarado: um erro de digitacao numa
      senha que ninguem consegue reler tranca a pessoa para fora da propria
      conta, e o unico caminho de volta seria repetir o fluxo inteiro.
    */
    confirmation: z.string().min(1, "Repita a nova senha."),
  })
  .refine((value) => value.password === value.confirmation, {
    message: "As senhas não coincidem.",
    path: ["confirmation"],
  });

export type ResetActionState =
  | { status: "idle" }
  | { status: "error"; message: string }
  | { status: "done"; message: string };

export const RESET_INITIAL_STATE: ResetActionState = { status: "idle" };

export const PASSWORD_RESET_SUCCESS_MESSAGE =
  "Senha redefinida. Você já pode entrar com a nova senha.";

/**
 * Link invalido, expirado ou ja usado — a mesma frase para os tres.
 *
 * Distinguir "expirado" de "ja usado" contaria a quem tem o link o que
 * aconteceu com ele, e o proximo passo e identico nos tres casos: pedir outro.
 */
export const PASSWORD_RESET_LINK_INVALID_MESSAGE =
  "Este link de redefinição não é mais válido. Peça um novo link para continuar.";

/**
 * Marcadores que o callback devolve a `/recuperar-senha`.
 *
 * Mesma disciplina do OAuth: **rotulo fechado** na URL, traducao na tela. O
 * link de recuperacao passa por `/auth/callback`, e quando a troca falha a
 * pessoa precisa voltar para o lugar onde pede outro — nao para o login com uma
 * frase sobre o Google.
 */
export const RECOVERY_RESULT_MESSAGE: Record<string, string> = {
  link_invalido: PASSWORD_RESET_LINK_INVALID_MESSAGE,
};

/* -------------------------------------------------------------------------
   Login com Google
   ------------------------------------------------------------------------- */

/**
 * O provedor nao pode iniciar o fluxo nesta instalacao.
 *
 * O caso comum e configuracao ausente — Google desabilitado no Supabase, sem
 * credencial. Isso nao e culpa de quem clicou, e a frase oferece o caminho que
 * funciona em vez de descrever o estado do servidor.
 */

export const AUTH_SERVICE_UNAVAILABLE_MESSAGE =
  "Não foi possível entrar agora: o serviço de login não respondeu, então sua senha nem chegou a ser conferida. Tente de novo em instantes.";

/** Credencial recusada. Mesma frase para conta inexistente e senha errada. */
export const INVALID_CREDENTIALS_MESSAGE = "E-mail ou senha inválidos.";

export const OAUTH_UNAVAILABLE_MESSAGE =
  "Não foi possível continuar com o Google agora. Você pode entrar com e-mail e senha.";

/** A pessoa recusou no consentimento do provedor. Escolha, e nao falha. */
export const OAUTH_CANCELLED_MESSAGE =
  "Você cancelou a entrada com o Google. Nada foi alterado na sua conta.";

/** Qualquer outro desfecho do retorno: sem detalhe do provedor. */
export const OAUTH_FAILED_MESSAGE =
  "Não foi possível concluir a entrada com o Google. Tente novamente ou use e-mail e senha.";

/**
 * Marcadores que o callback devolve na URL de `/entrar`.
 *
 * Sao **rotulos fechados**, e nao mensagens: texto de erro em querystring vaza
 * para historico do navegador, log de proxy e cabecalho `Referer`. A tela
 * traduz o rotulo; a URL nao carrega o motivo.
 */
export const OAUTH_RESULT_MESSAGE: Record<string, string> = {
  cancelado: OAUTH_CANCELLED_MESSAGE,
  falhou: OAUTH_FAILED_MESSAGE,
};
