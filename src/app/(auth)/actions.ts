"use server";

import { createHash } from "node:crypto";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";

import {
  AUTH_SERVICE_UNAVAILABLE_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  loginSchema,
  passwordResetSchema,
  recoveryRequestSchema,
  signupSchema,
  OAUTH_UNAVAILABLE_MESSAGE,
  PASSWORD_RESET_LINK_INVALID_MESSAGE,
  PASSWORD_RESET_SUCCESS_MESSAGE,
  RECOVERY_REQUESTED_MESSAGE,
  SIGNUP_PENDING_CONFIRMATION_MESSAGE,
  SIGNUP_UNAVAILABLE_MESSAGE,
  type AuthActionState,
  type AuthFormValues,
  type RecoveryActionState,
  type ResetActionState,
} from "@/lib/contracts/auth";
import {
  consumeRateLimit,
  rateLimitIdentity,
} from "@/lib/security/rate-limit";
import { DEFAULT_POST_AUTH_PATH, safeInternalPath } from "@/lib/security/safe-redirect";
import { AUTH_CONTEXT_PARAM, mfaPathFor, parseAuthContext } from "@/lib/contracts/auth-context";
import { PROFESSIONAL_ONBOARDING_PATH } from "@/lib/contracts/professional-state";
import { postAuthDestination } from "@/server/auth-context";
import { MFA_VERIFICATION_PATH } from "@/server/auth-mfa";
import { getAuthenticatedUser, isTransportFailure } from "@/server/auth";
import { clearCurrentAppLock } from "@/server/app-lock";
import { createClient } from "@/lib/supabase/server";
import {
  RECOVERY_TOKEN_HASH_PATTERN,
  deliverRecoveryEmail,
  recoveryDeliveryMode,
} from "@/server/services/recovery-delivery-service";
import {
  appendAudit,
  appendConsentGrant,
  materializePendingConsents,
  recordPendingConsent,
} from "@/server/repositories/identity-repository";


/**
 * Limite de tentativas de autenticacao.
 *
 * A chave e o IP encaminhado, e nao o e-mail: limitar por e-mail permitiria que
 * um atacante bloqueasse a conta de outra pessoa so repetindo o login dela.
 * Limitar pela origem contem a forca bruta sem entregar um vetor de negacao de
 * servico contra usuarios legitimos.
 */
async function authRateLimitExceeded(): Promise<boolean> {
  const requestHeaders = await headers();
  const identity = rateLimitIdentity(
    null,
    requestHeaders.get("x-forwarded-for"),
  );
  return !consumeRateLimit("auth", identity).allowed;
}

const RATE_LIMITED_MESSAGE =
  "Muitas tentativas. Aguarde alguns instantes e tente novamente.";

/**
 * Devolve ao formulario o que a pessoa digitou e que deve sobreviver ao erro.
 *
 * `VR-007`: com `<form action>` o React reseta os campos nao controlados
 * quando a acao termina. Sem isso, quem erra a senha redigita o e-mail inteiro.
 *
 * A senha nunca volta - e o unico campo que a pessoa vai reescrever de
 * qualquer jeito, e devolve-la seria colocar credencial no payload da resposta
 * sem ganho nenhum.
 */
function preservado(formData: FormData): AuthFormValues {
  const email = formData.get("email");
  const displayName = formData.get("displayName");
  return {
    email: typeof email === "string" ? email : undefined,
    displayName: typeof displayName === "string" ? displayName : undefined,
  };
}

/**
 * Materializa o consentimento pendente onde a sessao **nasce**.
 *
 * Login e callback sao os dois unicos pontos em que uma sessao passa a existir,
 * e sao por isso o "primeiro acesso autenticado". A alternativa — chamar de
 * `requireAuthenticatedUser` — custaria uma ida ao banco em **toda** navegacao
 * para um evento que acontece uma vez na vida da conta.
 *
 * Falha nao derruba a entrada: quem acabou de provar a identidade tem direito de
 * entrar. A proxima sessao tenta de novo, e a repeticao e segura porque a
 * reivindicacao e o insert vivem na mesma transacao — insert que falha nao deixa
 * a pendencia marcada como consumida.
 */
async function materializarConsentimentoPendente(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<void> {
  try {
    await materializePendingConsents(supabase);
  } catch {
    // Sem identificador de pessoa no log, como manda a politica da V1.
    console.warn("elyra.pending_consent_materialization_failed");
  }
}

export async function loginAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const values = preservado(formData);
  const falha = (message: string): AuthActionState => ({
    status: "error",
    message,
    // O login ja tem a propria tela; oferecer "entrar" aqui seria circular.
    offerSignIn: false,
    values,
  });

  if (await authRateLimitExceeded()) return falha(RATE_LIMITED_MESSAGE);

  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return falha(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) {
    /*
      Tres desfechos, e so o ultimo e sobre a credencial (`L-285`):
      - servico fora do ar (rede, timeout, 5xx): a senha nem foi conferida;
      - 429 do proprio GoTrue: e limite, e nao senha errada;
      - o resto: frase generica de proposito, que nao revela se a conta existe.
    */
    if (isTransportFailure(error)) {
      console.warn("elyra.login_auth_unavailable");
      return falha(AUTH_SERVICE_UNAVAILABLE_MESSAGE);
    }
    if (error.status === 429) return falha(RATE_LIMITED_MESSAGE);
    return falha(INVALID_CREDENTIALS_MESSAGE);
  }

  await materializarConsentimentoPendente(supabase);


  const temTotpVerificado = (data.user?.factors ?? []).some(
    (fator) => fator.status === "verified" && fator.factor_type === "totp",
  );

  const destino = data.user
    ? await postAuthDestination(supabase, data.user.id, {
        intent: parseAuthContext(formData.get(AUTH_CONTEXT_PARAM)),
        next: formData.get("next")?.toString() ?? null,
      })
    : DEFAULT_POST_AUTH_PATH;
  if (temTotpVerificado) {
    return { status: "mfa_required", next: mfaPathFor(destino, MFA_VERIFICATION_PATH) };
  }

  /*
    Mesmo tratamento do segundo fator, pelo mesmo motivo medido (`L-176`).
    `redirect("/dashboard")` daqui de dentro levava a pessoa ao Dashboard e o
    portao a devolvia para `/entrar` **sem mensagem** — 6 em 6 tentativas nesta
    instalacao, com o cookie de sessao ja gravado. Devolver o destino e deixar o
    cliente navegar com os cookies assentados resolve os dois casos com a mesma
    regra.
  */
  return { status: "authenticated", next: destino };
}

export async function signupAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const values = preservado(formData);
  /*
    `offerSignIn` acompanha **o balde da resposta**, e nao o caso individual.

    Ele e `true` apenas em `SIGNUP_UNAVAILABLE_MESSAGE` - a resposta unica que
    cobre "conta ja existe" **e** qualquer outra falha do servidor. Como as duas
    sao byte a byte iguais, ligar o convite ali nao distingue nada: quem sonda
    um e-mail ja aprende mais pelo redirect que o sucesso faria.

    Nos erros sobre o que foi digitado - senha fraca, e-mail malformado, termos
    - ele fica `false`. Convidar a entrar embaixo de "a senha deve conter um
    numero" mandaria a pessoa para o lugar errado.
  */
  const falha = (message: string, offerSignIn = false): AuthActionState => ({
    status: "error",
    message,
    offerSignIn,
    values,
  });

  /** A resposta indistinguivel: conta existente e falha desconhecida caem aqui. */
  const indisponivel = () => falha(SIGNUP_UNAVAILABLE_MESSAGE, true);

  if (await authRateLimitExceeded()) return falha(RATE_LIMITED_MESSAGE);

  const parsed = signupSchema.safeParse({
    displayName: formData.get("displayName"),
    email: formData.get("email"),
    password: formData.get("password"),
    acceptedTerms: formData.get("acceptedTerms") === "on",
  });
  if (!parsed.success) {
    return falha(parsed.error.issues[0]?.message ?? "Dados inválidos.");
  }

  /*
    O link de confirmacao volta pelo `/auth/callback`, e nao pela `site_url`.

    E o mesmo motivo do `L-163`: o fluxo e PKCE, o que retorna e um `code`, e a
    troca por sessao precisa acontecer onde da para gravar cookie. Passando por
    la, a confirmacao termina com sessao valida — que e exatamente a condicao
    para materializar o consentimento pendente.
  */
  // F1: conta criada pela entrada profissional segue ao cadastro profissional
  // (nunca ao portal). A conta e a mesma; so o destino muda.
  const signupDestination =
    parseAuthContext(formData.get(AUTH_CONTEXT_PARAM)) === "professional"
      ? PROFESSIONAL_ONBOARDING_PATH
      : "/dashboard";
  const origin = await requestOrigin();
  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: origin
        ? `${origin}/auth/callback?next=${encodeURIComponent(signupDestination)}`
        : undefined,
    },
  });

  /*
    A — erro real.

    A decisao usa o **codigo estruturado** do erro, e nao a mensagem humana:
    texto e traduzido, reescrito entre versoes e nao e contrato. Os codigos
    abaixo foram observados no runtime desta instalacao (GoTrue via
    `@supabase/supabase-js` 2.112.4), e nao deduzidos da documentacao:

      e-mail ja registrado  AuthApiError          code=user_already_exists  422
      senha fraca           AuthWeakPasswordError code=weak_password        422
      e-mail malformado     AuthApiError          code=validation_failed    400

    `email_exists` nao apareceu por este caminho - ele pertence a API
    administrativa -, e esta na lista assim mesmo porque custa nada e evita que
    uma troca de versao transforme "conta existente" em erro sem tratamento.

    O codigo fica **dentro** do servidor. O que sai daqui e uma frase que nao
    diz se a conta existe: `/cadastro` nao pode virar ferramenta de enumeracao.
    Senha e e-mail malformado sao sobre o que a pessoa digitou, e nao sobre
    quem ja e cadastrado - esses podem ser especificos.
  */
  if (error) {
    const code = error.code;
    if (code === "weak_password" || code === "validation_failed") {
      return falha(error.message);
    }
    return indisponivel();
  }

  if (!data.user) return indisponivel();

  /*
    C — conta criada, sessao ausente.

    Acontece quando a confirmacao por e-mail esta ligada: o `signUp` devolve o
    usuario e deixa a sessao para depois do clique no link. Hoje a instalacao
    usa `MAILER_AUTOCONFIRM=true` e este ramo nao roda - o que nao o torna
    inutil: sem ele, ligar a confirmacao faria toda conta criada com sucesso
    ser anunciada como falha, com o usuario existindo no banco.

    Pode ser publico sem risco: e o desfecho da tentativa de criar a **propria**
    conta, e nao resposta a uma pergunta sobre a conta de outra pessoa.

    O consentimento nao e gravado aqui de proposito - sem sessao, a escrita
    cairia na RLS. Ele pertence ao primeiro acesso autenticado, e o dia em que
    a confirmacao for ligada esse caminho precisa ser construido.
  */
  if (!data.session) {

    try {
      await recordPendingConsent(supabase, {
        userId: data.user.id,
        purpose: "terms_privacy",
        documentVersion: "v1",
      });
    } catch {
      console.warn("elyra.pending_consent_unavailable");
    }

    return {
      status: "pending_confirmation",
      message: SIGNUP_PENDING_CONFIRMATION_MESSAGE,
    };
  }

  // B — conta criada e autenticada: o caminho de sempre.
  try {
    const consent = await appendConsentGrant(supabase, {
      userId: data.user.id,
      purpose: "terms_privacy",
      documentVersion: "v1",
    });
    await appendAudit(supabase, {
      actorUserId: data.user.id,
      action: "account.created",
      entityType: "consent_event",
      entityId: consent.id,
      correlationId: crypto.randomUUID(),
    });
  } catch {
    await supabase.auth.signOut({ scope: "local" });
    return falha("Não foi possível registrar o consentimento.");
  }

  redirect(signupDestination);
}

export async function signOutAction() {
  const auth = await getAuthenticatedUser().catch(() => null);
  const supabase = auth?.supabase ?? await createClient();
  if (auth) {
    await clearCurrentAppLock(supabase, auth.user.id).catch(() => {
      console.warn("elyra.app_lock_logout_cleanup_unavailable");
    });
  }
  await supabase.auth.signOut({ scope: "local" });
  redirect("/entrar");
}



/**
 * A origem desta instalacao, lida da propria requisicao.
 *
 * O link de recuperacao e o retorno do OAuth precisam de URL absoluta, e ela
 * muda por ambiente: `127.0.0.1:3000` local, um tunel no QA fisico, um dominio
 * em producao. Deriva-la da request evita mais uma variavel de ambiente para
 * alguem esquecer de trocar — e `x-forwarded-proto` e o mesmo sinal que o
 * cookie ja usa para decidir `Secure`.
 */
async function requestOrigin(): Promise<string | null> {
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin");
  if (origin) return origin;

  const host = requestHeaders.get("host");
  if (!host) return null;
  const proto = requestHeaders.get("x-forwarded-proto") ?? "http";
  return `${proto}://${host}`;
}

/**
 * Redireciona para fora do site.
 *
 * `typedRoutes` faz `redirect` aceitar apenas rota interna — o que e uma boa
 * regra e por isso nao vai ser desligada. O consentimento do Google e externo
 * por definicao, entao a excecao fica **aqui**, num lugar so, nomeada e
 * comentada, em vez de virar um cast solto no meio do fluxo.
 */
function redirectExternal(url: string): never {
  redirect(url as unknown as Parameters<typeof redirect>[0]);
}

/**
 * "Esqueci minha senha".
 *
 * ## A resposta e sempre a mesma
 *
 * Conta existente, conta inexistente, provedor de e-mail fora do ar: os tres
 * terminam em `RECOVERY_REQUESTED_MESSAGE`. Se a tela distinguisse, este
 * formulario seria um enumerador melhor que o de cadastro — sem exigir senha,
 * sem exigir nada. O log do servidor registra a falha real; a tela nao.
 *
 * O rate limit tem balde proprio: diferente de login, cada tentativa aqui
 * dispara e-mail para o endereco digitado, e o limite que protege a conta nao e
 * o mesmo que protege a caixa de entrada de terceiro.
 */
export async function requestPasswordRecoveryAction(
  _previous: RecoveryActionState,
  formData: FormData,
): Promise<RecoveryActionState> {
  const email = formData.get("email");
  const values: AuthFormValues = {
    email: typeof email === "string" ? email : undefined,
  };

  const requestHeaders = await headers();
  const identity = rateLimitIdentity(null, requestHeaders.get("x-forwarded-for"));
  if (!consumeRateLimit("passwordRecovery", identity).allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE, values };
  }

  const parsed = recoveryRequestSchema.safeParse({ email });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Informe um e-mail válido.",
      values,
    };
  }

  /*
    Modo `elyra` (ADR-0022): a Elyra gera o link e envia pela Brevo.

    O envio roda em `after()`, **depois** de a resposta sair. Medido na stack
    local: `generateLink` leva ~1 s para conta existente e ~25 ms para conta
    inexistente — esperar o envio aqui transformaria o tempo de resposta num
    enumerador de contas. Com `after`, as duas respostas saem no mesmo tempo, e
    falha do provedor nao pode mudar a tela.

    Balde extra por destinatario, chaveado por hash: `generateLink` nao passa
    pelo limite de envio por endereco do GoTrue.
  */
  if (recoveryDeliveryMode() === "elyra") {
    const recipientKey = createHash("sha256")
      .update(parsed.data.email.trim().toLowerCase())
      .digest("hex");
    if (consumeRateLimit("passwordRecoveryRecipient", `rcpt:${recipientKey}`).allowed) {
      const destino = parsed.data.email;
      after(async () => {
        try {
          await deliverRecoveryEmail(destino);
        } catch {
          console.warn("elyra.password_recovery_unavailable");
        }
      });
    }
    return { status: "sent", message: RECOVERY_REQUESTED_MESSAGE };
  }

  /*
    O link do e-mail aponta para `/auth/callback`, e **nao** direto para
    `/redefinir-senha`.

    O motivo e o PKCE, provado contra a instalacao real: `@supabase/ssr` fixa
    `flowType: "pkce"`, entao o `verify` do GoTrue devolve a pessoa com
    `?code=...` — um codigo, e nao uma sessao. Alguem precisa troca-lo, e esse
    alguem tem de conseguir **gravar cookie**. Server Component nao grava (ver o
    `setAll` de `supabase/server.ts`), entao a troca dentro da pagina morreria em
    silencio: o GoTrue aceitaria, a sessao seria descartada e todo reset real
    terminaria em "link invalido".

    `/auth/callback` ja faz exatamente essa troca, com teste. Reusa-la aqui evita
    um segundo caminho de exchange para divergir do primeiro, e ainda limpa o
    `code` da URL antes de a tela de nova senha aparecer.

    `flow=recovery` existe para o callback saber qual fluxo falhou: um link de
    recuperacao expirado nao pode responder com a copy do Google.
  */
  const origin = await requestOrigin();
  const retorno = origin
    ? `${origin}/auth/callback?next=${encodeURIComponent("/redefinir-senha")}&flow=recovery`
    : undefined;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: retorno,
  });

  if (error) {
    /*
      Falha real — provedor ausente, cota estourada, endereco recusado — vira
      log, e nao mensagem. Contar na tela que "nao foi possivel enviar" para um
      e-mail e "enviamos" para outro entrega a existencia da conta pela porta
      dos fundos.
    */
    console.warn("elyra.password_recovery_unavailable");
  }

  return { status: "sent", message: RECOVERY_REQUESTED_MESSAGE };
}

/**
 * Confirma o link de recuperacao enviado pela Elyra (ADR-0022).
 *
 * ## Por que uma action, e nao um GET que troca o token
 *
 * Scanners de e-mail corporativo abrem links para inspeciona-los. Se o GET
 * consumisse o token de uso unico, o scanner "usaria" o link antes da pessoa, e
 * ela chegaria a uma tela de link invalido. A pagina `/redefinir-senha/confirmar`
 * so mostra um botao; o token e trocado aqui, num POST que so a pessoa dispara.
 *
 * ## O que e verificado
 *
 * Rate limit por IP (mesmo balde da redefinicao), forma do `token_hash`
 * (hexadecimal, antes de ir ao GoTrue) e tipo fixo `recovery` — o tipo nao vem
 * do cliente. Expirado, ja usado, forjado ou malformado terminam no mesmo
 * lugar: `/recuperar-senha?erro=link_invalido`. O token nunca entra em log.
 */
export async function confirmRecoveryAction(formData: FormData): Promise<void> {
  const invalido = "/recuperar-senha?erro=link_invalido";
  const requestHeaders = await headers();
  const identity = rateLimitIdentity(null, requestHeaders.get("x-forwarded-for"));
  if (!consumeRateLimit("passwordReset", identity).allowed) redirect(invalido);

  const raw = formData.get("token_hash");
  const tokenHash = typeof raw === "string" ? raw.trim() : "";
  if (!RECOVERY_TOKEN_HASH_PATTERN.test(tokenHash)) redirect(invalido);

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });
  if (error) {
    console.warn("elyra.recovery_confirm_failed");
    redirect(invalido);
  }
  redirect("/redefinir-senha");
}

/**
 * Define a nova senha.
 *
 * Depende de uma **sessao de recuperacao**: o link do e-mail leva a
 * `/redefinir-senha`, onde o Supabase troca o token por sessao antes de a
 * pessoa digitar qualquer coisa. Sem essa sessao, `updateUser` nao tem em quem
 * aplicar a mudanca — e e exatamente esse o caso de link expirado, ja usado ou
 * forjado. Os tres respondem igual, porque o proximo passo e o mesmo: pedir
 * outro link.
 */
export async function resetPasswordAction(
  _previous: ResetActionState,
  formData: FormData,
): Promise<ResetActionState> {
  /*
    Balde proprio, e **antes** de olhar a sessao.

    Limitar so depois de `getUser` deixaria o endpoint aberto justamente para
    quem chega sem sessao de recuperacao valida — que e o perfil de quem esta
    tentando adivinhar. A chave e o IP pelo mesmo motivo: nao ha usuario
    conhecido para chavear.
  */
  const resetHeaders = await headers();
  const resetIdentity = rateLimitIdentity(
    null,
    resetHeaders.get("x-forwarded-for"),
  );
  if (!consumeRateLimit("passwordReset", resetIdentity).allowed) {
    return { status: "error", message: RATE_LIMITED_MESSAGE };
  }

  const parsed = passwordResetSchema.safeParse({
    password: formData.get("password"),
    confirmation: formData.get("confirmation"),
  });
  if (!parsed.success) {
    return {
      status: "error",
      message: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { status: "error", message: PASSWORD_RESET_LINK_INVALID_MESSAGE };
  }

  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    /*
      A mensagem do provedor entra aqui **so** quando fala do que a pessoa
      digitou (senha fraca, senha igual a anterior). Qualquer outra coisa vira a
      frase de link invalido: o detalhe interno nao ajuda quem esta na tela e
      pode descrever o estado da conta.
    */
    const sobreASenha =
      error.code === "weak_password" || error.code === "same_password";
    return {
      status: "error",
      message: sobreASenha ? error.message : PASSWORD_RESET_LINK_INVALID_MESSAGE,
    };
  }

  /*
    A sessao de recuperacao e encerrada aqui.

    Quem redefine a senha precisa entrar com ela — e assim a tela prova que a
    senha nova funciona, em vez de deixar a pessoa autenticada por um link de
    e-mail que ja cumpriu a funcao. `scope: "local"` mantem o comportamento que
    o `signOutAction` ja usa nesta instalacao.
  */
  await supabase.auth.signOut({ scope: "local" });
  return { status: "done", message: PASSWORD_RESET_SUCCESS_MESSAGE };
}

/**
 * Inicia o login com Google.
 *
 * `skipBrowserRedirect` porque **nao ha cliente de navegador** neste projeto:
 * quem fala com o Supabase e o servidor. A action recebe a URL de autorizacao e
 * redireciona por conta propria, preservando o modelo server-side que a V1
 * aprovou — nenhum token passa pelo JavaScript da pagina.
 *
 * O destino pos-login viaja em `next`, e ele e validado **duas vezes**: aqui,
 * antes de virar parametro, e no callback, antes de virar redirect. Validar so
 * no fim bastaria para a seguranca; validar aqui tambem evita construir uma URL
 * de autorizacao que carrega um destino que sera descartado depois.
 */
export async function signInWithGoogleAction(
  _previous: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  if (await authRateLimitExceeded()) {
    return {
      status: "error",
      message: RATE_LIMITED_MESSAGE,
      offerSignIn: false,
    };
  }

  const next = safeInternalPath(formData.get("next")?.toString());
  // A intencao atravessa o Google no nosso proprio callback, validada de novo la.
  const intent = parseAuthContext(formData.get(AUTH_CONTEXT_PARAM));
  const origin = await requestOrigin();
  if (!origin) {
    return {
      status: "error",
      message: OAUTH_UNAVAILABLE_MESSAGE,
      offerSignIn: false,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}${
        intent ? `&${AUTH_CONTEXT_PARAM}=${intent}` : ""
      }`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data?.url) {
    // Provedor nao configurado nesta instalacao e o caso comum aqui, e ele nao
    // e culpa de quem clicou: a mensagem oferece o caminho que funciona.
    console.warn("elyra.oauth_start_unavailable");
    return {
      status: "error",
      message: OAUTH_UNAVAILABLE_MESSAGE,
      offerSignIn: false,
    };
  }

  redirectExternal(data.url);
}
