"use client";

import {
  AlertTriangle,
  CheckCircle2,
  CloudOff,
  LoaderCircle,
  LogIn,
  RefreshCw,
  UploadCloud,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { useLinkState } from "@/components/offline/connectivity";
import { useGatewayState, useOfflineGateway } from "@/components/offline/offline-context";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LINK_STATE, type LinkState } from "@/lib/offline/connectivity";
import {
  CONNECTIVITY,
  OUTBOX_DOMAIN,
  OUTBOX_KIND,
  OUTBOX_STATUS,
  type OutboxOperation,
} from "@/lib/offline/contracts";
import type { GatewayState, OfflineGateway } from "@/lib/offline/gateway";
import { cn } from "@/lib/utils";



type Summary = {
  label: string;
  tone: "neutral" | "brand" | "attention" | "destructive";
  icon: typeof CloudOff;
};

export function summarize(state: GatewayState, link?: LinkState): Summary | null {
  const pending = state.operations.length;
  const conflicts = state.operations.filter((op) => op.status === OUTBOX_STATUS.CONFLICT).length;
  const failed = state.operations.filter((op) => op.status === OUTBOX_STATUS.FAILED).length;
  const plural = (n: number) => (n === 1 ? "1 alteração" : `${n} alterações`);

  if (state.connectivity === CONNECTIVITY.AUTH_REQUIRED) {
    return { label: "Entre de novo para sincronizar", tone: "attention", icon: LogIn };
  }
  if (conflicts > 0) return { label: "Conflito para revisar", tone: "attention", icon: AlertTriangle };
  if (failed > 0) return { label: "Não sincronizou", tone: "destructive", icon: AlertTriangle };
  if (state.syncing && pending > 0) return { label: "Sincronizando…", tone: "brand", icon: LoaderCircle };
  if (link === LINK_STATE.RECONNECTING) {
    return { label: "Reconectando…", tone: "neutral", icon: LoaderCircle };
  }
  const offline = link ? link === LINK_STATE.OFFLINE : state.connectivity === CONNECTIVITY.OFFLINE;
  if (offline) {
    return {
      label: pending > 0 ? `Sem conexão · ${plural(pending)} neste aparelho` : "Sem conexão",
      tone: "neutral",
      icon: CloudOff,
    };
  }
  if (pending > 0) return { label: `${plural(pending)} a sincronizar`, tone: "brand", icon: UploadCloud };
  return null;
}

const TONE: Record<Summary["tone"], string> = {
  neutral: "border-line bg-surface text-ink-muted",
  brand: "border-brand-200 bg-surface-brand text-brand-700",
  attention: "border-attention/40 bg-attention-soft text-attention",
  destructive: "border-destructive/30 bg-destructive-soft text-destructive",
};

export function SyncIndicator({ className }: { className?: string }) {
  const gateway = useOfflineGateway();
  const state = useGatewayState(gateway);
  const link = useLinkState();
  const summary = summarize(state, link);
  if (!gateway || !summary) return null;
  const Icon = summary.icon;

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          data-elyra-sync-status=""
          aria-live="polite"
          className={cn(
            "motion-press inline-flex min-h-11 max-w-[11rem] items-center gap-1.5 rounded-pill border px-3 text-xs font-medium sm:max-w-none lg:min-h-9",
            TONE[summary.tone],
            className,
          )}
        >
          <Icon
            className={cn("size-4 shrink-0", Icon === LoaderCircle && "animate-spin")}
            aria-hidden="true"
          />
          <span className="truncate">{summary.label}</span>
        </button>
      </DialogTrigger>
      <SyncCenter gateway={gateway} state={state} />
    </Dialog>
  );
}

function describe(operation: OutboxOperation): string {
  const body = operation.request.body as Record<string, unknown>;
  switch (operation.domain) {
    case OUTBOX_DOMAIN.JOURNAL:
      if (operation.kind === OUTBOX_KIND.DELETE) return "Exclusão de anotação do diário";
      if (body.action === "trash") return "Anotação movida para a lixeira";
      if (body.action === "restore") return "Anotação restaurada";
      return `Diário: ${String(body.title ?? "").trim() || "anotação sem título"}`;
    case OUTBOX_DOMAIN.CHECKIN:
      return "Check-in de humor";
    case OUTBOX_DOMAIN.SLEEP:
      return `Sono de ${formatDiaMesOuOriginal(String(body.night ?? ""))}`;
    case OUTBOX_DOMAIN.GOAL:
      if (operation.kind === OUTBOX_KIND.CREATE) return `Nova meta: ${String(body.title ?? "")}`;
      return isGoalEdit(operation) ? `Edição de meta: ${String(body.title ?? "")}` : "Mudança de status de meta";
    case OUTBOX_DOMAIN.GOAL_PROGRESS:
      return "Progresso de meta";
    case OUTBOX_DOMAIN.CYCLE_RECORD:
      return operation.kind === OUTBOX_KIND.DELETE
        ? `Exclusão do registro do ciclo de ${formatDiaMesOuOriginal(String(body.date ?? ""))}`
        : `Registro do ciclo de ${formatDiaMesOuOriginal(String(body.date ?? ""))}`;
    default:
      return "Alteração";
  }
}

/** OFF-2: edicao de meta (PUT). Em conflito nao se oferece "usar a minha versao". */
function isGoalEdit(operation: OutboxOperation) {
  return operation.domain === OUTBOX_DOMAIN.GOAL && operation.request.method === "PUT";
}

/** Dia e mes (dd/mm), devolvendo a entrada quando ela nao e uma data. */
function formatDiaMesOuOriginal(iso: string) {
  const [year, month, day] = iso.split("-");
  return year && month && day ? `${day}/${month}` : iso;
}

function statusLine(operation: OutboxOperation): string {
  if (operation.status === OUTBOX_STATUS.CONFLICT && isGoalEdit(operation)) {
    return operation.conflictCurrent === null
      ? "Esta meta foi removida em outro dispositivo."
      : "Esta meta foi alterada em outro dispositivo. Carregue a versão mais recente e revise.";
  }
  if (operation.status === OUTBOX_STATUS.CONFLICT) {
    return operation.lastError?.code === "entity_gone" || operation.conflictCurrent === null
      ? "Este registro foi removido ou está na lixeira em outro aparelho."
      : "Este registro mudou em outro aparelho.";
  }
  if (operation.status === OUTBOX_STATUS.FAILED) {
    return operation.lastError?.code === "rejected"
      ? "O servidor recusou esta alteração. O conteúdo continua guardado aqui."
      : "O servidor não respondeu depois de várias tentativas.";
  }
  if (operation.lastError?.code === "auth_required") return "Aguardando você entrar de novo.";
  if (operation.attempts > 0 && Date.parse(operation.nextAttemptAt) > Date.now()) {
    return `Guardado neste aparelho · nova tentativa às ${new Date(operation.nextAttemptAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
  }
  return "Guardado neste aparelho · aguardando sincronizar";
}

function SyncCenter({ gateway, state }: { gateway: OfflineGateway; state: GatewayState }) {
  const [confirmDiscard, setConfirmDiscard] = useState<string | null>(null);
  const offline = state.connectivity === CONNECTIVITY.OFFLINE;

  return (
    <DialogContent className="sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Sincronização</DialogTitle>
        <DialogDescription>
          {state.operations.length === 0
            ? "Nada pendente neste aparelho."
            : "Alterações guardadas neste aparelho que ainda não chegaram à sua conta. Nada é descartado sem você decidir."}
        </DialogDescription>
      </DialogHeader>

      {state.connectivity === CONNECTIVITY.AUTH_REQUIRED ? (
        <p className="mb-3 flex flex-wrap items-center gap-2 rounded-control bg-attention-soft px-3 py-2 text-sm text-attention">
          Sua sessão expirou. As alterações continuam guardadas.
          <Link href="/entrar" className="font-medium underline">
            Entrar novamente
          </Link>
        </p>
      ) : null}

      {!state.storageAvailable ? (
        <p role="alert" className="mb-3 rounded-control bg-destructive-soft px-3 py-2 text-sm text-destructive">
          Este navegador não permite guardar dados neste aparelho. Sem conexão, as alterações não podem ser salvas.
        </p>
      ) : null}

      {state.operations.length === 0 ? (
        <p className="flex items-center gap-2 text-sm text-positive">
          <CheckCircle2 className="size-4" aria-hidden="true" />
          Tudo sincronizado.
        </p>
      ) : (
        <ul className="flex max-h-[50dvh] flex-col gap-2 overflow-y-auto">
          {state.operations.map((operation) => {
            const conflict = operation.status === OUTBOX_STATUS.CONFLICT;
            const failed = operation.status === OUTBOX_STATUS.FAILED;
            const journal = operation.domain === OUTBOX_DOMAIN.JOURNAL && operation.kind !== OUTBOX_KIND.DELETE;
            const gone = conflict && operation.conflictCurrent === null;
            return (
              <li key={operation.id} className="rounded-control border border-line bg-surface p-3">
                <p className="text-sm font-medium text-ink [overflow-wrap:anywhere]">{describe(operation)}</p>
                <p
                  className={cn(
                    "text-xs",
                    conflict ? "text-attention" : failed ? "text-destructive" : "text-ink-muted",
                  )}
                >
                  {statusLine(operation)}
                </p>
                {conflict || failed ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {conflict && journal ? (
                      <Button size="sm" onClick={() => void gateway.keepBoth(operation.id)}>
                        {gone ? "Manter como anotação nova" : "Manter as duas versões"}
                      </Button>
                    ) : null}
                    {conflict && isGoalEdit(operation) ? (
                      <Button size="sm" onClick={() => void gateway.discard(operation.id)}>
                        Carregar a versão mais recente
                      </Button>
                    ) : null}
                    {conflict && !gone && !isGoalEdit(operation) ? (
                      <Button size="sm" variant="secondary" onClick={() => void gateway.keepMine(operation.id)}>
                        Usar a minha versão
                      </Button>
                    ) : null}
                    {failed ? (
                      <Button size="sm" variant="secondary" onClick={() => void gateway.retry(operation.id)}>
                        <RefreshCw aria-hidden="true" />
                        Tentar de novo
                      </Button>
                    ) : null}
                    {conflict && isGoalEdit(operation) ? null : confirmDiscard === operation.id ? (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirmDiscard(null);
                          void gateway.discard(operation.id);
                        }}
                      >
                        Confirmar: descartar a minha alteração
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setConfirmDiscard(operation.id)}>
                        {conflict && !gone ? "Manter a da conta" : "Descartar"}
                      </Button>
                    )}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-ink-subtle">
          {offline ? "Sem conexão agora. A sincronização começa sozinha quando a rede voltar." : null}
        </p>
        <Button
          variant="secondary"
          disabled={offline || state.syncing || state.operations.length === 0}
          onClick={() => void gateway.drain()}
        >
          <RefreshCw aria-hidden="true" className={cn(state.syncing && "animate-spin")} />
          Sincronizar agora
        </Button>
      </div>
    </DialogContent>
  );
}
