"use client";

import { useEffect, useState } from "react";

import { Disclosure } from "@/components/ui/disclosure";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";


export function TrainingConsent() {
  const [enabled, setEnabled] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/learning/consent");
        const payload = (await response.json()) as {
          data?: { enabled: boolean };
          error?: string;
        };
        if (!response.ok || !payload.data) {
          throw new Error(payload.error ?? "Não foi possível ler a escolha.");
        }
        if (active) setEnabled(payload.data.enabled);
      } catch (caught) {
        if (active) {
          setError(
            caught instanceof Error
              ? caught.message
              : "Não foi possível ler a escolha.",
          );
        }
      } finally {
        if (active) setLoaded(true);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  async function change(on: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/learning/consent", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ enabled: on }),
      });
      const payload = (await response.json()) as {
        data?: { enabled: boolean };
        error?: string;
      };
      if (!response.ok || !payload.data) {
        throw new Error(payload.error ?? "Não foi possível salvar a escolha.");
      }
      // O estado vem da resposta do servidor, nao do gesto: se a RPC recusar, o
      // switch volta sozinho para o que o banco diz.
      setEnabled(payload.data.enabled);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Não foi possível salvar a escolha.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contribuir com o aprendizado da Elyra</CardTitle>
        <CardDescription>
          Opcional. A Elyra funciona por completo com isto desligado.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <Label htmlFor="cfg-training-consent">
              Permitir uso dos meus relatórios para aprendizado
            </Label>
            <p className="mt-0.5 text-sm text-ink-muted">
              Gerar ou salvar um relatório{" "}
              <strong className="font-medium text-ink">
                não envia nada para treino
              </strong>
              . Desligar vale imediatamente e também alcança o que já foi enviado
              antes.
            </p>
            <Disclosure summary="Como funciona o envio" className="mt-1">
              Com esta opção ligada, um relatório só pode ser enviado por escolha
              sua, e mesmo assim ele passa antes por uma verificação que remove
              identificação e pode recusar o envio.
            </Disclosure>
            {error ? (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <Switch
            id="cfg-training-consent"
            checked={enabled}
            disabled={!loaded || busy}
            onCheckedChange={(on) => void change(on)}
          />
        </div>
        <p aria-live="polite" className="sr-only">
          {loaded
            ? enabled
              ? "Contribuição para aprendizado ativada."
              : "Contribuição para aprendizado desativada."
            : "Carregando sua escolha."}
        </p>
      </CardContent>
    </Card>
  );
}
