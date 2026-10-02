"use client";

import Image from "next/image";
import { ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";

import {
  confirmTotpEnrollmentAction,
  disableTotpAction,
  startTotpEnrollmentAction,
  type EnrollmentStart,
  type MfaFormState,
} from "@/app/(app)/seguranca/mfa-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";



const IDLE: MfaFormState = { status: "idle" };
const IconPill = ({ children }: { children: React.ReactNode }) => (
  <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-control bg-identity-50 text-identity-700 [&>svg]:size-4">
    {children}
  </span>
);

export function MfaCard({ enabled }: { enabled: boolean }) {
  const [enrollment, setEnrollment] = useState<EnrollmentStart | null>(null);
  const [starting, setStarting] = useState(false);
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmTotpEnrollmentAction,
    IDLE,
  );
  const [disableState, disableAction, disabling] = useActionState(disableTotpAction, IDLE);
  const [removing, setRemoving] = useState(false);

  const ativo = enabled || confirmState.status === "done";
  const desativado = disableState.status === "done";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start gap-3">
          <IconPill>
            <ShieldCheck />
          </IconPill>
          <div className="min-w-0">
            <CardTitle className="flex flex-wrap items-center gap-2">
              Verificação em duas etapas
              {ativo && !desativado ? (
                <Badge tone="positive">Ativa</Badge>
              ) : (
                <Badge tone="neutral">Não ativa</Badge>
              )}
            </CardTitle>
            <CardDescription>
              Um código do seu aplicativo autenticador, além da senha, para entrar.
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {ativo && !desativado ? (
          <>
            <p className="text-sm text-ink-muted">
              A Elyra vai pedir o código no próximo login. Guarde o acesso ao
              aplicativo autenticador: sem ele, e sem códigos de recuperação
              (que a Elyra ainda não oferece), entrar fica impossível.
            </p>
            {!removing ? (
              <Button variant="secondary" className="sm:w-fit" onClick={() => setRemoving(true)}>
                Desativar
              </Button>
            ) : (
              <form action={disableAction} className="flex flex-col gap-3 sm:max-w-sm">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="mfa-off-code">Código atual para confirmar</Label>
                  <Input
                    id="mfa-off-code"
                    name="code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={7}
                    placeholder="000000"
                  />
                </div>
                {disableState.status === "error" ? (
                  <p role="alert" className="text-sm text-destructive">
                    {disableState.message}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button type="submit" variant="destructive" disabled={disabling}>
                    {disabling ? "Desativando..." : "Confirmar e desativar"}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => setRemoving(false)}>
                    Cancelar
                  </Button>
                </div>
              </form>
            )}
          </>
        ) : enrollment?.status === "ready" ? (
          <form action={confirmAction} className="flex flex-col gap-4">
            <input type="hidden" name="factorId" value={enrollment.factorId} />
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
              <Image
                src={enrollment.qrCode}
                alt="QR Code para cadastrar a Elyra no aplicativo autenticador"
                width={160}
                height={160}
                unoptimized
                className="rounded-control border border-line bg-surface p-2"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-muted">
                  Aponte o aplicativo autenticador para o QR Code, ou digite este
                  código de configuração:
                </p>
                <p className="mt-2 break-all rounded-control bg-surface-muted px-3 py-2 font-mono text-sm text-ink">
                  {enrollment.secret}
                </p>
              </div>
            </div>

            <div className="flex flex-col gap-1.5 sm:max-w-xs">
              <Label htmlFor="mfa-on-code">Código gerado pelo aplicativo</Label>
              <Input
                id="mfa-on-code"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={7}
                placeholder="000000"
              />
            </div>

            {confirmState.status === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {confirmState.message}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={confirming}>
                {confirming ? "Confirmando..." : "Confirmar e ativar"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setEnrollment(null)}>
                Cancelar
              </Button>
            </div>
          </form>
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Funciona com qualquer aplicativo autenticador (Google Authenticator,
              Authy, 1Password, Bitwarden). Nada é enviado por SMS.
            </p>
            {enrollment?.status === "error" ? (
              <p role="alert" className="text-sm text-destructive">
                {enrollment.message}
              </p>
            ) : null}
            {disableState.status === "done" ? (
              <p role="status" className="text-sm text-ink-muted">
                {disableState.message}
              </p>
            ) : null}
            <Button
              className="sm:w-fit"
              disabled={starting}
              onClick={() => {
                setStarting(true);
                void startTotpEnrollmentAction()
                  .then(setEnrollment)
                  .finally(() => setStarting(false));
              }}
            >
              {starting ? "Preparando..." : "Ativar verificação em duas etapas"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}
