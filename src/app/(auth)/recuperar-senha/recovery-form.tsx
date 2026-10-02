"use client";

import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordRecoveryAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { AuthFrame, AuthTitle } from "@/components/layout/auth-frame";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  RECOVERY_INITIAL_STATE,
  RECOVERY_RESULT_MESSAGE,
  type AuthFormValues,
} from "@/lib/contracts/auth";


export function RecoveryForm({ result }: { result?: string | null }) {
  const [state, formAction, pending] = useActionState(
    requestPasswordRecoveryAction,
    RECOVERY_INITIAL_STATE,
  );

  const values: AuthFormValues =
    state.status === "error" ? (state.values ?? {}) : {};

  /*
    Chega como rotulo fechado, e nao como texto: quem monta a URL nao escolhe o
    que a tela diz. Rotulo desconhecido nao renderiza nada.
  */
  const aviso = result ? RECOVERY_RESULT_MESSAGE[result] : undefined;

  return (
    <AuthFrame>
      <Card variant="hero" className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center text-center">
          <Logo className="lg:hidden" />
          <AuthTitle>Recuperar acesso</AuthTitle>
        </CardHeader>
        <CardContent>
          {state.status === "sent" ? (
            <>
              <p
                role="status"
                className="rounded-control bg-surface-brand p-3 text-sm text-brand-700"
              >
                {state.message}
              </p>
              <p className="mt-5 text-center text-sm text-ink-muted">
                <Link
                  href="/entrar"
                  className="font-medium text-brand-700 hover:underline"
                >
                  Voltar para entrar
                </Link>
              </p>
            </>
          ) : (
            <>
              {aviso ? (
                <p
                  role="alert"
                  className="mb-4 rounded-control bg-destructive-soft p-3 text-sm text-destructive"
                >
                  {aviso}
                </p>
              ) : null}

              <p className="mb-4 text-sm text-ink-muted">
                Informe o e-mail da sua conta. Enviamos um link para você criar
                uma senha nova.
              </p>

              <form action={formAction} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="email">E-mail</Label>
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

                {state.status === "error" ? (
                  <p
                    role="alert"
                    className="rounded-control bg-destructive-soft p-3 text-sm text-destructive"
                  >
                    {state.message}
                  </p>
                ) : null}

                <Button type="submit" disabled={pending}>
                  {pending ? "Aguarde..." : "Enviar link de recuperação"}
                </Button>
              </form>

              <p className="mt-5 text-center text-sm text-ink-muted">
                Lembrou a senha?{" "}
                <Link
                  href="/entrar"
                  className="font-medium text-brand-700 hover:underline"
                >
                  Entrar
                </Link>
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
