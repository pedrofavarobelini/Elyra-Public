"use client";

import { BadgeCheck, UserRound } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { GoogleButton } from "@/app/(auth)/google-button";
import { PasskeyButton } from "@/app/(auth)/passkey-button";
import { MobilePreLoginSplash } from "@/components/brand/brand-experience";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { AuthFrame, AuthTitle } from "@/components/layout/auth-frame";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import {
  AUTH_INITIAL_STATE,
  OAUTH_RESULT_MESSAGE,
  type AuthActionState,
  type AuthFormValues,
} from "@/lib/contracts/auth";
import type { AuthContext } from "@/lib/contracts/auth-context";

interface AuthFormProps {
  mode: "login" | "signup";
  action: (
    state: AuthActionState,
    formData: FormData,
  ) => Promise<AuthActionState>;
  /**
   * O rotulo `?oauth=` com que o callback devolveu a pessoa a esta tela.
   *
   * Chega **cru**, e nao traduzido, porque a traducao e um vocabulario fechado:
   * o que a URL carrega e um rotulo conhecido ou nada. Texto vindo da
   * querystring nunca vira mensagem na tela — seria uma superficie de injecao
   * de conteudo aberta a qualquer um que saiba montar um link.
   */
  oauthResult?: string | null;

  entryContext?: AuthContext | null;
  /** Deep link validado que trouxe a pessoa ao login. */
  next?: string | null;
}

export function AuthForm({ mode, action, oauthResult, entryContext = null, next = null }: AuthFormProps) {
  const professional = entryContext === "professional";
  const [state, formAction, pending] = useActionState(action, AUTH_INITIAL_STATE);
  const router = useRouter();
  const signup = mode === "signup";

  const oauthMessage = oauthResult ? OAUTH_RESULT_MESSAGE[oauthResult] : undefined;
  // Cancelar e escolha, e nao falha: a tela nao pinta de vermelho quem desistiu.
  const oauthCancelado = oauthResult === "cancelado";

  /*
    O estado e discriminado, entao o que a tela le depende do desfecho. Ler
    `state.values` direto obrigaria o TypeScript a aceitar a propriedade em
    `idle` e em `pending_confirmation`, onde ela nao existe - e a garantia de
    que nenhum outro campo escapa para a tela viria abaixo junto.
  */
  const values: AuthFormValues = state.status === "error" ? (state.values ?? {}) : {};


  useEffect(() => {
    if (state.status === "mfa_required" || state.status === "authenticated") {
      router.replace(state.next as never);
    }
  }, [state, router]);

  return (
    <AuthFrame>
      {!signup ? <MobilePreLoginSplash /> : null}
      <Card variant="hero" className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center text-center">
          <Logo className="lg:hidden" />
          {professional ? (
            <p className="inline-flex items-center gap-1.5 rounded-pill bg-identity-50 px-2.5 py-1 text-xs font-medium text-identity-700">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Área profissional
            </p>
          ) : null}
          <AuthTitle>
            {signup
              ? professional
                ? "Criar conta para atuar como profissional"
                : "Criar sua conta"
              : professional
                ? "Entrar como profissional"
                : "Entrar na Elyra"}
          </AuthTitle>
          {professional ? (
            <p className="text-sm text-ink-muted" data-testid="auth-context-note">
              {signup
                ? "É uma conta Elyra comum. Depois de criar, você segue para o cadastro profissional e a verificação do registro."
                : "Mesma conta Elyra, mesma senha e mesmo Google. Depois de entrar, você vai para a sua área profissional."}
            </p>
          ) : null}
        </CardHeader>
        <CardContent>
          {oauthMessage ? (
            <p
              role="status"
              className={
                oauthCancelado
                  ? "mb-4 rounded-control bg-surface-muted p-3 text-sm text-ink-muted"
                  : "mb-4 rounded-control bg-destructive-soft p-3 text-sm text-destructive"
              }
            >
              {oauthMessage}
            </p>
          ) : null}

          <form action={formAction} className="flex flex-col gap-4">
            {entryContext && (!signup || professional) ? <input type="hidden" name="context" value={entryContext} /> : null}
            {next && !signup ? <input type="hidden" name="next" value={next} /> : null}
            {signup ? (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="displayName">Nome</Label>
                <Input
                  id="displayName"
                  name="displayName"
                  autoComplete="name"
                  maxLength={80}
                  required
                  defaultValue={values.displayName ?? ""}
                />
              </div>
            ) : null}

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="email">E-mail</Label>
              {/*
                `VR-007`: o `<form action>` reseta os campos quando a acao
                termina, e o reset devolve cada campo ao seu `defaultValue`.
                Semeando-o com o que voltou da acao, o e-mail sobrevive ao erro
                em vez de ser apagado - quem errou a senha nao redigita o
                e-mail. A senha nao tem `defaultValue` de proposito.
              */}
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                maxLength={254}
                required
                defaultValue={values.email ?? ""}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="password">Senha</Label>
              <PasswordInput
                id="password"
                name="password"
                autoComplete={signup ? "new-password" : "current-password"}
                minLength={signup ? 8 : 1}
                maxLength={128}
                required
              />
              {signup ? (
                <p className="text-xs text-ink-subtle">
                  Use pelo menos 8 caracteres, com letra e número.
                </p>
              ) : null}
            </div>

            {signup ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-control py-1 text-sm text-ink-muted">
                <input
                  type="checkbox"
                  name="acceptedTerms"
                  className="mt-0.5 size-5 shrink-0 accent-brand-600"
                  required
                />
                <span>
                  Li e aceito os termos e a política de privacidade, versão v1.
                </span>
              </label>
            ) : null}

            {state.status === "error" ? (
              <div
                role="alert"
                className="rounded-control bg-destructive-soft p-3 text-sm text-destructive"
              >
                <p>{state.message}</p>
                {/*
                  O caminho de saida vem junto com o erro, e nao so no rodape.

                  Quem tenta criar uma conta que ja existe ve uma mensagem que
                  nao confirma nem nega isso - e precisa de um proximo passo na
                  mesma altura da tela, e nao de um link tres paragrafos abaixo
                  que ele ja ignorou uma vez.
                */}
                {state.offerSignIn ? (
                  <p className="mt-2">
                    <Link href="/entrar" className="font-medium underline">
                      Entrar na minha conta
                    </Link>
                  </p>
                ) : null}
              </div>
            ) : null}

            {state.status === "pending_confirmation" ? (
              /*
                Conta criada, faltando confirmar o e-mail. Nao e erro, e a tela
                nao pode pintar de vermelho o que deu certo - a pessoa acabou de
                conseguir o que veio fazer.
              */
              <p
                role="status"
                className="rounded-control bg-surface-brand p-3 text-sm text-brand-700"
              >
                {state.message}
              </p>
            ) : null}

            <Button type="submit" disabled={pending}>
              {pending
                ? "Aguarde..."
                : signup
                  ? "Criar conta"
                  : "Entrar"}
            </Button>
          </form>

          {signup ? null : (
            /*
              O link fica **abaixo** do botao, e nao ao lado do rotulo "Senha".
              Ao lado do campo, ele compete com a acao que a maioria veio fazer;
              depois da tentativa, esta onde a pessoa olha quando a senha falhou.
            */
            <p className="mt-3 text-center text-sm">
              <Link
                href="/recuperar-senha"
                className="font-medium text-brand-700 hover:underline"
              >
                Esqueci minha senha
              </Link>
            </p>
          )}

          <GoogleButton context={signup ? (professional ? "professional" : null) : entryContext} next={signup ? null : next} />
          {signup ? null : <PasskeyButton context={entryContext} next={next} />}

          <p className="mt-5 text-center text-sm text-ink-muted">
            {signup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
            <Link
              href={signup ? (professional ? "/entrar?context=professional" : "/entrar") : professional ? "/cadastro?context=professional" : "/cadastro"}
              className="font-medium text-brand-700 hover:underline"
            >
              {signup ? "Entrar" : "Criar conta"}
            </Link>
          </p>

          {signup ? null : (
            /*
              A outra entrada fica no rodape, discreta: e a mesma conta, entao nao
              compete com o formulario. So troca o destino depois de entrar.
            */
            <p className="mt-4 border-t border-line pt-4 text-center text-sm">
              <Link
                href={professional ? "/entrar?context=personal" : "/entrar?context=professional"}
                className="inline-flex min-h-11 items-center gap-1.5 font-medium text-identity-700 hover:underline"
                data-testid="auth-context-switch"
              >
                {professional ? (
                  <UserRound className="size-4" aria-hidden="true" />
                ) : (
                  <BadgeCheck className="size-4" aria-hidden="true" />
                )}
                {professional ? "Entrar na área pessoal" : "Entrar como profissional"}
              </Link>
            </p>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
