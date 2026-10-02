"use client";

import { ShieldAlert } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { helpRequestFetch } from "@/components/help-requests/help-request-list";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  HELP_REQUEST_COPY,
  HELP_REQUEST_POLICY,
  type HelpRequestTarget,
} from "@/lib/contracts/help-requests";

const SELECT =
  "mt-1.5 flex min-h-11 w-full rounded-control border border-line bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-400 lg:min-h-10";

/**
 * Enviar um pedido. O limite ("nao e emergencia, sem prazo, use o SOS") vem
 * ANTES do campo e fica sempre visivel (D-PRO8-2): consequencia nunca vai
 * para dentro de divulgacao.
 *
 * Idempotencia: uma chave por intencao. Reenviar o mesmo texto (duplo clique,
 * rede instavel) reusa a chave; mudar texto ou destino gera outra.
 */
export function HelpRequestForm({ targets }: { targets: HelpRequestTarget[] }) {
  const router = useRouter();
  const baseId = useId();
  const initial = targets.find((target) => !target.waiting) ?? targets[0];
  const [connectionId, setConnectionId] = useState(initial?.connectionId ?? "");
  const [body, setBody] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const target = targets.find((item) => item.connectionId === connectionId);
  const length = body.trim().length;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setSent(false);
    const idempotencyKey = key ?? crypto.randomUUID();
    setKey(idempotencyKey);
    setBusy(true);
    try {
      await helpRequestFetch("/api/help-requests", {
        method: "POST",
        body: JSON.stringify({ connectionId, body, idempotencyKey }),
      });
      setBody("");
      setKey(null);
      setSent(true);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" data-testid="help-request-form">
      <RequiresConnection>
      <div
        className="flex items-start gap-3 rounded-control border border-attention/30 bg-attention-soft px-3.5 py-3"
        data-testid="help-request-limit"
      >
        <ShieldAlert className="mt-0.5 size-4 shrink-0 text-attention" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-sm font-medium text-ink">{HELP_REQUEST_COPY.limitTitle}</p>
          <p className="text-sm text-ink">{HELP_REQUEST_COPY.limit}</p>
          {/* No celular o botao SOS sai de cena enquanto ha campo embaixo dele:
              o caminho para os contatos nao pode depender dele. */}
          <a
            href="#contatos-ajuda"
            onClick={() => {
              // Os contatos ficam num <details> fechado: abrir explicitamente, sem depender
              // de o navegador expandir sozinho ao seguir a ancora.
              const target = document.getElementById("contatos-ajuda");
              const details = target?.closest("details");
              if (details) details.open = true;
            }}
            className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-ink underline underline-offset-4 lg:min-h-9"
          >
            Ver contatos de ajuda imediata
          </a>
        </div>
      </div>

      <div>
        <Label htmlFor={`${baseId}-target`}>Para quem</Label>
        <select
          id={`${baseId}-target`}
          className={SELECT}
          value={connectionId}
          onChange={(event) => {
            setConnectionId(event.target.value);
            setKey(null);
          }}
        >
          {targets.map((item) => (
            <option key={item.connectionId} value={item.connectionId}>
              {item.professionalName ?? "Profissional"}
              {item.waiting ? " (recado aguardando)" : ""}
            </option>
          ))}
        </select>
        {target?.waiting ? <p className="mt-1.5 text-xs text-ink-muted">{HELP_REQUEST_COPY.waiting}</p> : null}
      </div>

      <div>
        <Label htmlFor={`${baseId}-body`}>Seu recado</Label>
        <Textarea
          id={`${baseId}-body`}
          className="mt-1.5"
          value={body}
          maxLength={HELP_REQUEST_POLICY.maxLength}
          aria-describedby={`${baseId}-count`}
          onChange={(event) => {
            setBody(event.target.value);
            setKey(null);
          }}
          rows={5}
        />
        <p id={`${baseId}-count`} className="mt-1.5 text-xs text-ink-muted">
          {length} de {HELP_REQUEST_POLICY.maxLength} caracteres. Sem anexos.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-control bg-attention-soft px-3.5 py-3 text-sm text-ink">
          {error}
        </p>
      ) : null}
      {sent ? (
        <p role="status" className="rounded-control bg-positive-soft px-3.5 py-3 text-sm text-ink">
          Recado enviado. Ele aparece abaixo como &quot;Enviado&quot; até o profissional abrir.
        </p>
      ) : null}

      <div>
        <Button type="submit" disabled={busy || length === 0 || !connectionId || target?.waiting === true}>
          {busy ? "Enviando..." : "Enviar recado"}
        </Button>
      </div>
      </RequiresConnection>
    </form>
  );
}
