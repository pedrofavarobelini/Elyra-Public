import type { Metadata } from "next";
import Link from "next/link";

import { confirmRecoveryAction } from "@/app/(auth)/actions";
import { AuthFrame, AuthTitle } from "@/components/layout/auth-frame";
import { Logo } from "@/components/layout/logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { PASSWORD_RESET_LINK_INVALID_MESSAGE } from "@/lib/contracts/auth";
import { RECOVERY_TOKEN_HASH_PATTERN } from "@/server/services/recovery-delivery-service";

/**
 * Chegada pelo link do e-mail de recuperacao enviado pela Elyra (ADR-0022).
 *
 * A pagina **nao** troca o token: so mostra um botao. Ver `confirmRecoveryAction`
 * para o motivo (scanners de e-mail que abrem links queimariam o token de uso
 * unico). Funciona sem JavaScript: e um `<form>` com Server Action.
 *
 * `referrer: no-referrer`: a URL carrega o token, e nenhum recurso desta pagina
 * pode anuncia-la a terceiros.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirmar redefinição de senha",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ConfirmarRedefinicaoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token_hash: raw } = await searchParams;
  const tokenHash = typeof raw === "string" ? raw.trim() : "";
  const valido = RECOVERY_TOKEN_HASH_PATTERN.test(tokenHash);

  return (
    <AuthFrame>
      <Card variant="hero" className="w-full max-w-md shadow-raised">
        <CardHeader className="items-center text-center">
          <Logo className="lg:hidden" />
          <AuthTitle>Redefinir sua senha</AuthTitle>
        </CardHeader>
        <CardContent>
          {valido ? (
            <form action={confirmRecoveryAction} className="flex flex-col gap-4">
              <p className="text-sm text-ink-muted">
                Para sua segurança, confirme que foi você quem pediu a redefinição.
                Em seguida você cria a nova senha.
              </p>
              <input type="hidden" name="token_hash" value={tokenHash} />
              <Button type="submit" data-testid="recovery-confirm">
                Continuar para criar a nova senha
              </Button>
            </form>
          ) : (
            <div role="alert" className="rounded-control bg-destructive-soft p-3 text-sm text-destructive">
              <p>{PASSWORD_RESET_LINK_INVALID_MESSAGE}</p>
              <p className="mt-2">
                <Link href="/recuperar-senha" className="font-medium underline">
                  Pedir um novo link
                </Link>
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </AuthFrame>
  );
}
