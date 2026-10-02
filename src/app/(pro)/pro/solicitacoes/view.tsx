"use client";

import { Inbox } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import { BlockError } from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, type PortalInvite } from "@/lib/professional/portal";
import { InvitesPanel } from "./invites-panel";


export function SolicitacoesView({
  hasProfile,
  verified,
  requests,
  requestsAvailable,
  invites,
  invitesAvailable,
  acceptedNames,
  inviteEnvironment = null,
}: {
  hasProfile: boolean;
  verified: boolean;
  requests: Array<{ id: string; invitedAt: string }>;
  requestsAvailable: boolean;
  invites: PortalInvite[];
  invitesAvailable: boolean;
  acceptedNames: Record<string, string>;
  inviteEnvironment?: "local" | "staging" | null;
}) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "accepted" | "declined"; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function respond(connectionId: string, action: "accept" | "decline") {
    setBusyId(connectionId);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/professional/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId, action }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível responder.");
      // MOTION-2: a solicitacao some da lista; o texto diz o que aconteceu.
      setNotice(
        action === "accept"
          ? { kind: "accepted", text: "Solicitação aceita. O vínculo está ativo; nenhum dado é compartilhado por isso." }
          : { kind: "declined", text: "Solicitação recusada." },
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível responder.");
    } finally {
      setBusyId(null);
    }
  }

  if (!hasProfile) {
    return (
      <>
        <PageHeader title="Central de solicitações" />
        <Card>
          <CardContent>
            <EmptyState
              title="Perfil profissional necessário"
              description="Cadastre seu registro para gerar convites e receber solicitações de acompanhamento."
              action={
                <Button asChild>
                  <Link href="/area-profissional/cadastro">Cadastrar registro</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Central de solicitações"
        description="Solicitações de acompanhamento que esperam sua resposta e os convites que você gerou."
      />

      <div className="grid items-start gap-5 lg:gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)]" data-layout="columns">
        <Card data-layout-column="side">
          <CardHeader>
            <CardTitle as="h2">Aguardando você</CardTitle>
            <CardDescription>
              Solicitações de acompanhamento feitas pela pessoa (pela descoberta ou diretamente). Aceitar ativa o vínculo; nada é compartilhado por isso.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!requestsAvailable ? (
              <BlockError what="as solicitações de acompanhamento" />
            ) : requests.length === 0 ? (
              <EmptyState
                size="compact"
                icon={<Inbox />}
                title="Nenhuma solicitação esperando resposta"
                description="Quando alguém solicitar acompanhamento com você, a solicitação aparece aqui."
              />
            ) : (
              <RequiresConnection>
              <ul className="flex flex-col divide-y divide-line">
                {requests.map((request) => (
                  <li key={request.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="mr-auto min-w-0">
                      <p className="text-sm font-medium text-ink">Solicitação de acompanhamento</p>
                      <p className="text-sm text-ink-muted">
                        Recebido em {formatDate(request.invitedAt)}. O nome aparece depois do aceite.
                      </p>
                    </div>
                    {verified ? (
                      <Button size="sm" disabled={busyId === request.id} onClick={() => void respond(request.id, "accept")}>
                        Aceitar
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busyId === request.id}
                      onClick={() => void respond(request.id, "decline")}
                    >
                      Recusar
                    </Button>
                  </li>
                ))}
              </ul>
              </RequiresConnection>
            )}
            {!verified && requests.length > 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                Aceitar exige verificação vigente do seu registro.
              </p>
            ) : null}
            {error ? <p role="alert" className="mt-3 text-sm text-destructive">{error}</p> : null}
            {notice ? (
              <p
                key={notice.text}
                role="status"
                data-testid="request-notice"
                className={notice.kind === "accepted" ? "motion-rise-in mt-3 text-sm text-positive" : "mt-3 text-sm text-ink-muted"}
              >
                {notice.text}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div data-layout-column="main">
          {invitesAvailable ? (
            <InvitesPanel verified={verified} initialInvites={invites} acceptedNames={acceptedNames} environment={inviteEnvironment} />
          ) : (
            <BlockError what="os convites" />
          )}
        </div>
      </div>
    </>
  );
}
