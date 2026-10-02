"use client";

import { useActionState } from "react";

import { acceptTermsAction } from "@/app/primeiro-acesso/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { AuthFrame, AuthTitle } from "@/components/layout/auth-frame";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  CURRENT_TERMS_PRIVACY_VERSION,
  FIRST_ACCESS_INITIAL_STATE,
  TERMS_DOCUMENTS_AVAILABLE,
} from "@/lib/contracts/consent";

/**
 * Primeiro acesso: onde a pessoa aceita os termos da Elyra.
 *
 * Entrar com o Google prova identidade e nao diz nada sobre os termos daqui —
 * sao dois contratos, e a tela de consentimento do Google fala pelo Google.
 * Quem chega por OAuth nunca passou pelo formulario de cadastro, entao e aqui
 * que a pergunta e feita.
 *
 * Sem redesign: o mesmo cartao, a mesma tipografia e os mesmos componentes das
 * telas de autenticacao.
 */
export function FirstAccessForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState(
    acceptTermsAction,
    FIRST_ACCESS_INITIAL_STATE,
  );

  return (
    <AuthFrame>
      <Card variant="hero" className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center text-center">
          <Logo className="lg:hidden" />
          <AuthTitle>Antes de começar</AuthTitle>
        </CardHeader>
        <CardContent>
          {TERMS_DOCUMENTS_AVAILABLE ? (
            <>
              <p className="mb-4 text-sm text-ink-muted">
                Para usar a Elyra, é preciso aceitar os Termos de Uso e a
                Política de Privacidade, versão {CURRENT_TERMS_PRIVACY_VERSION}.
                A Elyra é destinada a maiores de 18 anos.
              </p>

              {/*
                Enquanto nao houver rota publica servindo os documentos, a tela
                diz onde eles estao e em que estado. Prometer um link que nao
                existe seria pior que a ausencia dele.
              */}
              <p className="mb-4 rounded-control bg-surface-muted p-3 text-xs text-ink-muted">
                Versão técnica v1, ainda em revisão jurídica. O texto integral
                está na documentação do projeto e descreve exatamente o que o
                sistema faz com seus dados.
              </p>

              <form action={formAction} className="flex flex-col gap-4">
                <input type="hidden" name="next" value={next} />
                {/*
                  Nunca pre-marcada. Consentimento presumido nao e consentimento,
                  e uma caixa que ja vem marcada registra a inercia de quem
                  clicou em "continuar", e nao a decisao de ninguem.
                */}
                <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control py-1 text-sm text-ink-muted">
                  <input
                    type="checkbox"
                    name="acceptedTerms"
                    className="mt-0.5 size-5 shrink-0 accent-brand-600"
                    required
                  />
                  <span>
                    Li e aceito os Termos de Uso e a Política de Privacidade,
                    versão {CURRENT_TERMS_PRIVACY_VERSION}.
                  </span>
                </label>

                {state.status === "error" ? (
                  <p
                    role="alert"
                    className="rounded-control bg-destructive-soft p-3 text-sm text-destructive"
                  >
                    {state.message}
                  </p>
                ) : null}

                <Button type="submit" disabled={pending}>
                  {pending ? "Aguarde..." : "Continuar"}
                </Button>
              </form>
            </>
          ) : (
            <>
              {/*
                Os documentos ainda nao existem no produto. A tela diz isso em
                vez de oferecer um aceite que nao teria objeto — e a acao recusa
                no servidor, porque proteger so na tela nao protege.
              */}
              <p
                role="status"
                className="rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
              >
                Os Termos de Uso e a Política de Privacidade da Elyra estão em
                preparação. Enquanto o texto não existir, não pedimos que você
                concorde com ele — seria pedir sua concordância com algo que
                ninguém pode ler.
              </p>
              <p className="mt-4 text-sm text-ink-muted">
                Sua conta está criada e seu acesso continua aqui quando os
                documentos estiverem publicados.
              </p>
            </>
          )}

          <p className="mt-5 text-center text-sm text-ink-muted">
            <a
              href="/api/auth/sair"
              className="font-medium text-brand-700 hover:underline"
            >
              Sair da conta
            </a>
          </p>
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
