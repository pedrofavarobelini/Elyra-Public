"use client";

import { Fingerprint } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { finishPasskeySignInAction, startPasskeySignInAction } from "@/app/passkey-actions";
import { Button } from "@/components/ui/button";
import {
  CAPABILITY_STATUS,
  passkeyCapability,
  passkeyOriginSupported,
} from "@/lib/capabilities";
import {
  browserSupportsPasskeys,
  PasskeyClientError,
  requestPasskey,
} from "@/lib/passkeys";

function browserMessage(error: unknown) {
  if (error instanceof PasskeyClientError && error.code === "cancelled") return "A tentativa foi cancelada.";
  if (error instanceof PasskeyClientError && error.code === "unsupported") return "Este navegador não oferece chaves de acesso.";
  if (error instanceof PasskeyClientError && error.code === "invalid_origin") return "Abra a Elyra pelo endereço seguro configurado para usar a chave de acesso.";
  if (error instanceof PasskeyClientError && error.code === "not_available") return "Nenhum autenticador compatível está disponível neste aparelho.";
  return "Não foi possível abrir a chave de acesso.";
}

export function PasskeyButton({ context = null, next = null }: { context?: string | null; next?: string | null }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [browserSupported, setBrowserSupported] = useState<boolean | null>(null);
  const [originSupported, setOriginSupported] = useState<boolean | null>(null);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setBrowserSupported(browserSupportsPasskeys());
      setOriginSupported(passkeyOriginSupported(window.location.hostname));
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const capability = passkeyCapability(true, browserSupported, originSupported ?? true);
  const capabilityReady = browserSupported !== null && originSupported !== null;
  const canSignIn = capabilityReady && capability.status === CAPABILITY_STATUS.SUPPORTED;

  /*
   * A tela de entrada nao transforma incompatibilidade de WebAuthn em um
   * "erro" grande. Passkey e um metodo adicional: se navegador/origem nao
   * suportarem a cerimonia, senha e Google continuam sendo os caminhos
   * visiveis. Em aparelhos compativeis (inclusive mobile), o botao aparece.
   */
  if (capabilityReady && !canSignIn) return null;

  async function signIn() {
    setPending(true);
    setMessage(null);
    try {
      const started = await startPasskeySignInAction();
      if (started.status === "error") return setMessage(started.message);
      const credential = await requestPasskey(started.options);
      const finished = await finishPasskeySignInAction(
        { challengeId: started.challengeId, credential },
        { context, next },
      );
      if (finished.status === "error") return setMessage(finished.message);
      router.replace((finished.next ?? "/dashboard") as never);
    } catch (error) {
      setMessage(browserMessage(error));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-2">
      <Button type="button" variant="secondary" disabled={!canSignIn || pending} onClick={signIn}>
        <Fingerprint aria-hidden="true" />
        {pending ? "Aguardando o aparelho..." : "Entrar com chave de acesso"}
      </Button>
      {message ? <p role="status" className="text-center text-sm text-ink-muted">{message}</p> : null}
    </div>
  );
}
