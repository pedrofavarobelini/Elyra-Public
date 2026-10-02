"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";


export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Politica de logs da V1: nunca conteudo da pessoa, so identificador.
    console.error("elyra.pro_error", error.digest ?? error.name);
  }, [error]);

  return (
    <div className="flex min-h-[60dvh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <span
            className="flex size-12 items-center justify-center rounded-full bg-attention-soft"
            aria-hidden="true"
          >
            <AlertTriangle className="size-6 text-attention" />
          </span>

          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-semibold text-ink">
              Esta página não carregou
            </h1>
            <p className="text-sm text-ink-muted">
              A conexão com o servidor falhou no meio do carregamento. Nenhum
              registro seu foi perdido.
            </p>
          </div>

          <Button onClick={reset}>Tentar novamente</Button>

          {error.digest ? (
            <p className="text-xs text-ink-subtle">
              Código para suporte: {error.digest}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
