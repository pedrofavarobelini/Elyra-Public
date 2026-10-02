"use client";

import { useActionState } from "react";

import { signInWithGoogleAction } from "@/app/(auth)/actions";
import { Button } from "@/components/ui/button";
import { AUTH_INITIAL_STATE } from "@/lib/contracts/auth";

/**
 * O "G" oficial, embutido.
 *
 * Inline e nao `<img>`: um arquivo remoto num dominio do Google carregado na
 * tela de login vaza o acesso para um terceiro antes de qualquer decisao da
 * pessoa, e ainda exigiria abrir `img-src` na CSP. SVG inline nao e script e
 * nao conflita com o nonce.
 */
function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 3-2.26 5.54-4.78 7.25l7.73 6c4.51-4.18 7.09-10.36 7.09-17.72z"
      />
      <path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </svg>
  );
}


export function GoogleButton({ context = null, next = null }: { context?: string | null; next?: string | null }) {
  const [state, formAction, pending] = useActionState(
    signInWithGoogleAction,
    AUTH_INITIAL_STATE,
  );

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-line" />
        <span className="text-xs uppercase tracking-wide text-ink-subtle">ou</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form action={formAction} className="mt-4">
        {/* Stage 29 / AUTH-CONTEXT: revalidados no servidor (allowlist e caminho interno). */}
        {context ? <input type="hidden" name="context" value={context} /> : null}
        {next ? <input type="hidden" name="next" value={next} /> : null}
        <Button
          type="submit"
          variant="secondary"
          disabled={pending}
          className="w-full"
        >
          <GoogleMark />
          {pending ? "Aguarde..." : "Continuar com o Google"}
        </Button>
      </form>

      {state.status === "error" ? (
        <p
          role="alert"
          className="mt-3 rounded-control bg-destructive-soft p-3 text-sm text-destructive"
        >
          {state.message}
        </p>
      ) : null}
    </div>
  );
}
