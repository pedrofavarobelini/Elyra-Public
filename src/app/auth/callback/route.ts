import { NextResponse, type NextRequest } from "next/server";

import {
  consumeRateLimit,
  rateLimitIdentity,
} from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { materializePendingConsents } from "@/server/repositories/identity-repository";
import { AUTH_CONTEXT_PARAM, parseAuthContext } from "@/lib/contracts/auth-context";
import { postAuthDestination } from "@/server/auth-context";

/**
 * Location relativo preserva o host em que o navegador recebeu a sessao.
 * NextRequest normaliza 127.0.0.1 para localhost; reconstruir uma URL absoluta
 * a partir dele muda o dominio do cookie e faz um callback valido perder login.
 * Todos os destinos sao constantes internas ou passam por safeInternalPath.
 */
function redirectWithinOrigin(path: string) {
  return new NextResponse(null, { status: 307, headers: { Location: path } });
}


export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const next = safeInternalPath(url.searchParams.get("next"));

  /*
    Endereco publico: qualquer pessoa monta um link para ca, e cada chamada com
    `code` invalido custa uma ida ao provedor de identidade. Chave por IP, porque
    sessao e justamente o que ainda nao existe neste ponto.

    Excedido, o retorno e o mesmo caminho de falha dos demais desfechos — e nao
    um 429 cru: quem chega aqui veio de um redirect de navegador, e merece uma
    tela, nao um JSON.
  */
  const limit = consumeRateLimit(
    "oauthCallback",
    rateLimitIdentity(null, request.headers.get("x-forwarded-for")),
  );

  /*
    O provedor sinaliza recusa com `error`, e nao com ausencia de `code`.
    Distinguir os dois muda a copy: cancelar e uma escolha, e nao uma falha.
  */
  /*
    O mesmo endereco serve dois fluxos, porque a troca de `code` por sessao e
    identica nos dois — e porque ela precisa acontecer onde da para gravar
    cookie, o que exclui Server Components.

    O que **nao** e identico e o desfecho de uma falha: quem clicou num link de
    recuperacao vencido precisa voltar para `/recuperar-senha` e pedir outro, e
    nao para o login lendo uma frase sobre o Google.
  */
  const recuperacao = url.searchParams.get("flow") === "recovery";
  const falhou = () =>
    redirectWithinOrigin(
      recuperacao ? "/recuperar-senha?erro=link_invalido" : "/entrar?oauth=falhou",
    );

  if (!limit.allowed) return falhou();

  const providerError = url.searchParams.get("error");
  if (providerError) {
    if (recuperacao) return falhou();
    const motivo = providerError === "access_denied" ? "cancelado" : "falhou";
    return redirectWithinOrigin(`/entrar?oauth=${motivo}`);
  }

  const code = url.searchParams.get("code");
  if (!code) return falhou();

  const supabase = await createClient();
  const { data: exchanged, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    // Sem conteudo e sem codigo do provedor no log, como manda a politica da V1.
    console.warn(
      recuperacao ? "elyra.recovery_exchange_failed" : "elyra.oauth_exchange_failed",
    );
    return falhou();
  }

  /*
    A sessao acabou de nascer, entao este e um "primeiro acesso autenticado" —
    inclusive o que segue a confirmacao de e-mail. Se o cadastro deixou uma
    intencao de consentimento pendente, e aqui que ela vira historico.

    Idempotente no banco: repetir o callback devolve zero e nao duplica nada.
    Falhar aqui nao pode barrar quem acabou de confirmar o proprio e-mail.
  */
  try {
    await materializePendingConsents(supabase);
  } catch {
    console.warn("elyra.pending_consent_materialization_failed");
  }


  if (recuperacao) return redirectWithinOrigin(next);
  // O usuario vem da propria troca: nenhuma ida extra ao provedor.
  const user = exchanged?.user ?? exchanged?.session?.user ?? null;
  if (!user) return redirectWithinOrigin(next);
  const destino = await postAuthDestination(supabase, user.id, {
    intent: parseAuthContext(url.searchParams.get(AUTH_CONTEXT_PARAM)),
    next: url.searchParams.get("next"),
  });
  return redirectWithinOrigin(destino);
}
