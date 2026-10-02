"use client";

import { useActionState } from "react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { verifyMfaChallengeAction, type MfaChallengeState } from "@/app/(auth)/mfa-actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const INICIAL: MfaChallengeState = { status: "idle" };


export function MfaVerificationForm({ next = "/dashboard" }: { next?: string }) {
  const [state, formAction, pending] = useActionState(verifyMfaChallengeAction, INICIAL);
  const router = useRouter();

  // Sucesso: a sessao virou `aal2` no servidor, e o portao deixa passar.
  useEffect(() => {
    if (state.status === "verified") router.replace(next as never);
  }, [state, router, next]);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mfa-code">Código do aplicativo</Label>
        <Input
          id="mfa-code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          autoFocus
          maxLength={7}
          placeholder="000000"
          aria-describedby="mfa-ajuda"
        />
        <p id="mfa-ajuda" className="text-xs text-ink-subtle">
          Seis dígitos, gerados pelo seu aplicativo autenticador.
        </p>
      </div>

      {state.status === "error" ? (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "Verificando..." : "Confirmar e entrar"}
      </Button>
    </form>
  );
}
