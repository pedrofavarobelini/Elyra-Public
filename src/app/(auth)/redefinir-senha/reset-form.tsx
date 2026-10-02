"use client";

import Link from "next/link";
import { useActionState } from "react";

import { resetPasswordAction } from "@/app/(auth)/actions";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { AuthFrame, AuthTitle } from "@/components/layout/auth-frame";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { RESET_INITIAL_STATE } from "@/lib/contracts/auth";


export function ResetForm() {
  const [state, formAction, pending] = useActionState(
    resetPasswordAction,
    RESET_INITIAL_STATE,
  );

  return (
    <AuthFrame>
      <Card variant="hero" className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center text-center">
          <Logo className="lg:hidden" />
          <AuthTitle>Criar uma nova senha</AuthTitle>
        </CardHeader>
        <CardContent>
          {state.status === "done" ? (
            <>
              <p
                role="status"
                className="rounded-control bg-surface-brand p-3 text-sm text-brand-700"
              >
                {state.message}
              </p>
              <p className="mt-5 text-center text-sm">
                <Link
                  href="/entrar"
                  className="font-medium text-brand-700 hover:underline"
                >
                  Entrar com a nova senha
                </Link>
              </p>
            </>
          ) : (
            <form action={formAction} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="password">Nova senha</Label>
                <PasswordInput
                  id="password"
                  name="password"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
                <p className="text-xs text-ink-subtle">
                  Use pelo menos 8 caracteres, com letra e número.
                </p>
              </div>

              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirmation">Repita a nova senha</Label>
                {/*
                  O campo e mascarado: um erro de digitacao que ninguem consegue
                  reler trancaria a pessoa para fora da propria conta, e o unico
                  caminho de volta seria repetir o fluxo inteiro.
                */}
                <PasswordInput
                  id="confirmation"
                  name="confirmation"
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                />
              </div>

              {state.status === "error" ? (
                <div
                  role="alert"
                  className="rounded-control bg-destructive-soft p-3 text-sm text-destructive"
                >
                  <p>{state.message}</p>
                  <p className="mt-2">
                    <Link
                      href="/recuperar-senha"
                      className="font-medium underline"
                    >
                      Pedir um novo link
                    </Link>
                  </p>
                </div>
              ) : null}

              <Button type="submit" disabled={pending}>
                {pending ? "Aguarde..." : "Salvar nova senha"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
