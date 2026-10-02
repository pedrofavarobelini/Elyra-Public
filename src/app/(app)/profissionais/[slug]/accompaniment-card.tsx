"use client";

import { HeartHandshake } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { withReturnTo } from "@/lib/navigation/return-to";

type Status = "pending" | "active" | "paused" | "revoked" | "ended" | null;

/**
 * Relacao com este profissional, em quatro estados claros (L-398).
 *
 * - sem vinculo: pedir acompanhamento ou usar um codigo de convite;
 * - pendente: aguardando; a acao e **Cancelar solicitacao** (nunca "revogar
 *   conexao", que soa como tirar um acesso que nunca existiu);
 * - ativo (ou pausado): horario, recado, compartilhamento e **Encerrar vinculo**;
 * - encerrado: o profissional nao acessa mais nada; conectar de novo.
 *
 * No banco, cancelar um pedido e encerrar um vinculo sao a mesma transicao
 * (`revoked`); muda o que a pessoa le. Nada e compartilhado por pedir nem por o
 * profissional aceitar: os grants continuam da pessoa (Fluxo B, GAP-01).
 */
export function AccompanimentCard({
  slug,
  displayName,
  connectionId,
  initialStatus,
}: {
  slug: string;
  displayName: string;
  connectionId: string | null;
  initialStatus: Status;
}) {
  const router = useRouter();
  const origin = `/profissionais/${slug}`;
  const [status, setStatus] = useState<Status>(initialStatus);
  const [currentId, setCurrentId] = useState<string | null>(connectionId);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  async function call(input: RequestInfo, init: RequestInit, fallback: string) {
    const response = await fetch(input, init);
    const payload = (await response.json().catch(() => ({}))) as {
      data?: { status?: Status; id?: string; connectionId?: string };
      error?: string;
    };
    if (!response.ok) throw new Error(payload.error ?? fallback);
    return payload.data ?? {};
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      router.refresh();
    } catch (caught) {
      setMessage({
        kind: "error",
        text:
          caught instanceof TypeError
            ? "Sem conexão. Nada foi alterado."
            : caught instanceof Error
              ? caught.message
              : "Não foi possível concluir agora.",
      });
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  const request = () =>
    run(async () => {
      const data = await call(
        "/api/professional/connection-requests",
        { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug }) },
        "Não foi possível enviar a solicitação.",
      );
      setStatus(data.status ?? "pending");
      setCurrentId(data.connectionId ?? data.id ?? currentId);
      setMessage({ kind: "ok", text: "Solicitação enviada. Você será avisado quando houver resposta." });
    });

  const revoke = (kind: "cancel" | "end") =>
    run(async () => {
      if (!currentId) throw new Error("Vínculo não encontrado. Recarregue a página.");
      await call(
        "/api/professional/connections",
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId: currentId, action: "revoke" }),
        },
        kind === "cancel" ? "Não foi possível cancelar a solicitação." : "Não foi possível encerrar o vínculo.",
      );
      // Pedido cancelado volta ao "sem vinculo": nunca houve acesso para encerrar.
      setStatus(kind === "cancel" ? null : "revoked");
      setMessage({
        kind: "ok",
        text: kind === "cancel" ? "Solicitação cancelada." : "Vínculo encerrado. O profissional não acessa mais seus dados.",
      });
    });

  const sharingHref = withReturnTo("/configuracoes/privacidade#cfg-profissional", origin) as Route;
  const inviteHref = withReturnTo("/convite", origin) as Route;

  return (
    <Card data-testid="directory-accompaniment" data-state={status ?? "none"}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <HeartHandshake className="size-4 text-brand-700" aria-hidden="true" />
          Acompanhamento
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-3 text-sm leading-6 text-ink-muted">
        <RequiresConnection>
        {status === "active" || status === "paused" ? (
          <>
            <p className="font-medium text-ink" data-testid="relationship-state">
              {status === "active" ? "Profissional conectado" : "Vínculo pausado por você"}
            </p>
            <p>
              {status === "active"
                ? `${displayName} só vê o que você escolher compartilhar.`
                : `${displayName} não acessa nada enquanto o vínculo estiver pausado.`}
            </p>
            <div className="flex flex-wrap gap-2">
              {status === "active" && currentId ? (
                <Button asChild size="sm">
                  <Link href={`/agenda?vinculo=${currentId}`}>Pedir horário</Link>
                </Button>
              ) : null}
              {status === "active" ? (
                <Button asChild size="sm" variant="secondary">
                  <Link href="/pedidos">Enviar recado</Link>
                </Button>
              ) : null}
              <Button asChild size="sm" variant="secondary">
                <Link href={sharingHref}>Gerenciar compartilhamento</Link>
              </Button>
            </div>
            {confirming ? (
              <div className="flex flex-col gap-2 rounded-control border border-line p-3" role="group" aria-label="Confirmar encerramento">
                <p className="text-ink">
                  Encerrar o vínculo corta na hora todo acesso de {displayName}. Para voltar, será preciso um novo pedido ou convite.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => void revoke("end")}>
                    Encerrar vínculo
                  </Button>
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(false)}>
                    Manter vínculo
                  </Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirming(true)}>
                Encerrar vínculo
              </Button>
            )}
          </>
        ) : status === "pending" ? (
          <>
            <p className="font-medium text-ink" data-testid="relationship-state">
              Aguardando resposta do profissional
            </p>
            <p>Pedir não compartilha nenhum dado. Se o pedido for aceito, você escolhe o que mostrar.</p>
            <Button size="sm" variant="secondary" disabled={busy || !currentId} onClick={() => void revoke("cancel")}>
              Cancelar solicitação
            </Button>
          </>
        ) : status === "revoked" || status === "ended" ? (
          <>
            {/*
              `revoked` cobre vinculo encerrado pela pessoa E pedido cancelado (a RPC do
              diretorio so expoe o status); o titulo neutro e verdadeiro nos dois casos.
            */}
            <p className="font-medium text-ink" data-testid="relationship-state">
              {status === "ended" ? "Vínculo encerrado" : "Sem vínculo ativo"}
            </p>
            <p>O profissional não possui mais acesso aos seus dados.</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void request()}>
                {busy ? "Enviando…" : "Conectar novamente"}
              </Button>
              <Button asChild size="sm" variant="secondary">
                <Link href="/profissionais">Encontrar outro profissional</Link>
              </Button>
            </div>
          </>
        ) : (
          <>
            <p>
              Peça acompanhamento: o profissional recebe a solicitação na área dele e decide se aceita. Pedir não
              compartilha nenhum dado; depois do aceite, você escolhe o que mostrar.
            </p>
            <Button size="sm" disabled={busy} onClick={() => void request()}>
              {busy ? "Enviando…" : "Solicitar acompanhamento"}
            </Button>
          </>
        )}
        <div aria-live="polite" className="empty:hidden">
          {message ? (
            <p role={message.kind === "error" ? "alert" : "status"} className={message.kind === "error" ? "text-destructive" : "text-positive"}>
              {message.text}
            </p>
          ) : null}
        </div>
        </RequiresConnection>
        {status !== "active" && status !== "paused" ? (
          <p className="text-xs">
            Recebeu um código deste profissional?{" "}
            <Link href={inviteHref} className="font-medium text-brand-700 hover:underline">
              Tenho um código de convite
            </Link>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
