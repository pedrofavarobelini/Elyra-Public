"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  allowedHelpRequestActions,
  HELP_REQUEST_ACTION_LABEL,
  HELP_REQUEST_STATUS_LABEL,
  type HelpRequest,
  type HelpRequestAction,
  type HelpRequestStatus,
} from "@/lib/contracts/help-requests";

export const HELP_REQUEST_OFFLINE_MESSAGE = "Sem conexão. Recados só funcionam online: nada foi enviado.";

/** Chamada a partir da tela. Sem repeticao automatica; rede e regra sao mensagens diferentes. */
export async function helpRequestFetch<T>(input: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, {
      ...init,
      cache: "no-store",
      headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    throw new Error(HELP_REQUEST_OFFLINE_MESSAGE);
  }
  const payload = (await response.json().catch(() => ({}))) as { data?: T; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Os recados não responderam. Tente de novo.");
  return payload.data as T;
}

const TONE: Record<HelpRequestStatus, "brand" | "identity" | "positive" | "neutral" | "attention"> = {
  open: "brand",
  seen: "identity",
  responded: "positive",
  closed: "neutral",
  cancelled: "neutral",
  expired: "attention",
};

function formatWhen(iso: string) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));
}

function Item({ request, onError }: { request: HelpRequest; onError: (message: string | null) => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState<HelpRequestAction | null>(null);
  const actions = allowedHelpRequestActions(request.role, request.status);

  async function run(action: HelpRequestAction) {
    setBusy(action);
    onError(null);
    try {
      await helpRequestFetch(`/api/help-requests/${request.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action }),
      });
      router.refresh();
    } catch (error) {
      onError(error instanceof Error ? error.message : "Não foi possível atualizar o recado.");
    } finally {
      setBusy(null);
    }
  }

  const who = request.counterpartName ?? (request.role === "client" ? "Profissional" : "Pessoa acompanhada");

  return (
    <li
      className="flex flex-col gap-2 border-t border-line py-4 first:border-t-0 first:pt-0 last:pb-0"
      data-testid="help-request-item"
      data-status={request.status}
    >
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 text-sm font-medium text-ink">
          {request.role === "client" ? `Para ${who}` : `De ${who}`}
        </p>
        <Badge tone={TONE[request.status]}>{HELP_REQUEST_STATUS_LABEL[request.status]}</Badge>
      </div>
      <p className="text-xs text-ink-muted">
        Enviado em <time dateTime={request.createdAt}>{formatWhen(request.createdAt)}</time>
        {request.respondedAt ? (
          <>
            {" · "}respondido em <time dateTime={request.respondedAt}>{formatWhen(request.respondedAt)}</time>
          </>
        ) : null}
      </p>
      {request.body ? (
        <p className="whitespace-pre-line break-words rounded-control bg-surface-muted px-3.5 py-3 text-sm text-ink">
          {request.body}
        </p>
      ) : (
        <p className="text-sm text-ink-muted">O texto deste recado já foi apagado pela regra de retenção.</p>
      )}
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((action) => (
            <Button
              key={action}
              size="sm"
              variant={action === "responded" ? "primary" : "secondary"}
              disabled={busy !== null}
              onClick={() => void run(action)}
            >
              {busy === action ? "Salvando..." : HELP_REQUEST_ACTION_LABEL[action]}
            </Button>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function HelpRequestList({ requests, empty }: { requests: HelpRequest[]; empty: React.ReactNode }) {
  const [error, setError] = useState<string | null>(null);
  if (requests.length === 0) return <>{empty}</>;
  return (
    <div className="flex flex-col gap-3">
      {error ? (
        <p role="alert" className="rounded-control bg-attention-soft px-3.5 py-3 text-sm text-ink">
          {error}
        </p>
      ) : null}
      <ul className="flex flex-col" data-testid="help-request-list">
        {requests.map((request) => (
          <Item key={request.id} request={request} onError={setError} />
        ))}
      </ul>
    </div>
  );
}
