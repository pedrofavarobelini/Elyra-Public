"use client";

import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { PageHeader } from "@/components/journey/page-header";
import {
  BlockError,
  PersonCell,
  RelationshipStatusBadge,
} from "@/components/professional/portal-bits";
import { EmptyState } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { grantIsCurrent } from "@/lib/contracts/sharing";
import { GrantList } from "@/components/professional/grant-list";
import {
  formatDate,
  lastKnownChange,
  type PortalRelationship,
} from "@/lib/professional/portal";

const ORDER = { active: 0, paused: 1, revoked: 2, ended: 3, pending: 4 } as const;


export function VinculosView({
  hasProfile,
  relationships,
  available,
  now,
}: {
  /** Instante do servidor: servidor e navegador classificam os grants igual. */
  now: number;
  hasProfile: boolean;
  relationships: PortalRelationship[];
  available: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<PortalRelationship | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const sorted = useMemo(
    () =>
      [...relationships].sort(
        (a, b) =>
          ORDER[a.status] - ORDER[b.status] ||
          lastKnownChange(b).localeCompare(lastKnownChange(a)),
      ),
    [relationships],
  );

  async function end(relationship: PortalRelationship) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/professional/connections", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ connectionId: relationship.id, action: "revoke" }),
      });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível encerrar o vínculo.");
      setConfirming(null);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível encerrar o vínculo.");
    } finally {
      setBusy(false);
    }
  }

  if (!hasProfile) {
    return (
      <>
        <PageHeader title="Vínculos e acessos" />
        <Card>
          <CardContent>
            <EmptyState
              title="Perfil profissional necessário"
              description="Cadastre seu registro para ter vínculos."
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
        title="Vínculos e acessos"
        description="Estado de cada vínculo e o que cada pessoa compartilhou, por quanto tempo e de qual período."
      />

      {error ? <p role="alert" className="mb-4 text-sm text-destructive">{error}</p> : null}

      {!available ? (
        <BlockError what="os vínculos" />
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={<ShieldCheck />}
              title="Nenhum vínculo ainda"
              description="Um vínculo nasce quando a pessoa aceita seu convite. Os acessos aparecem aqui quando ela decidir compartilhar."
              action={
                <Button asChild>
                  <Link href="/pro/solicitacoes">Ir para convites</Link>
                </Button>
              }
            />
          </CardContent>
        </Card>
      ) : (
        <ul className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:gap-6 2xl:grid-cols-2" data-testid="vinculos-lista">
          {sorted.map((relationship) => {
            const grants = relationship.grants.filter(
              (grant) =>
                showHistory ||
                grantIsCurrent({
                  status: grant.status,
                  revoked_at: grant.revokedAt,
                  expires_at: grant.validUntil,
                  valid_from: grant.validFrom,
                }, now) ||
                (grant.validFrom !== null && Date.parse(grant.validFrom) > now),
            );
            const timeline = [
              { label: "Vínculo ativo desde", at: relationship.acceptedAt },
              { label: "Pausado pela pessoa em", at: relationship.pausedAt },
              { label: "Encerrado pela pessoa em", at: relationship.revokedAt },
              { label: "Encerrado por você em", at: relationship.endedAt },
            ].filter((item): item is { label: string; at: string } => Boolean(item.at));
            const open = relationship.status === "active" || relationship.status === "paused";
            return (
              <li key={relationship.id} className="min-w-0">
                <Card>
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      <PersonCell
                        className="mr-auto"
                        name={relationship.displayName}
                        caption={timeline[0] ? `${timeline[0].label} ${formatDate(timeline[0].at)}` : undefined}
                      />
                      <RelationshipStatusBadge status={relationship.status} />
                    </div>

                    {timeline.length > 1 ? (
                      <ol className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-muted">
                        {timeline.map((item) => (
                          <li key={item.label}>
                            {item.label} {formatDate(item.at)}
                          </li>
                        ))}
                      </ol>
                    ) : null}

                    {open ? (
                      grants.length === 0 ? (
                        <p className="rounded-control bg-surface-muted px-4 py-3 text-sm text-ink-muted">
                          Nada compartilhado no momento. Só a pessoa decide o que, por quanto tempo e de qual período.
                        </p>
                      ) : (
                        <GrantList
                          now={now}
                          label={`Acessos de ${relationship.displayName ?? "pessoa acompanhada"}`}
                          grants={grants}
                          suspended={relationship.status === "paused"}
                        />
                      )
                    ) : (
                      <p className="text-sm text-ink-muted">
                        Vínculo encerrado: todos os acessos foram revogados na mesma hora.
                      </p>
                    )}

                    {relationship.status === "paused" ? (
                      <p className="text-sm text-ink-muted">
                        Enquanto estiver pausado, nenhum acesso vale. Só a pessoa pode retomar.
                      </p>
                    ) : null}

                    {open ? (
                      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-3">
                        {relationship.status === "active" ? (
                          <Button asChild size="sm" variant="secondary">
                            <Link href={`/pro/acompanhamentos/${relationship.clientUserId}`}>Abrir dossiê</Link>
                          </Button>
                        ) : null}
                        <Button size="sm" variant="ghost" onClick={() => setConfirming(relationship)}>
                          Encerrar vínculo
                        </Button>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ul>
      )}

      {available && sorted.some((relationship) => relationship.grants.length > 0) ? (
        <div className="mt-4">
          <Button
            variant="link"
            size="sm"
            className="h-auto min-h-11 whitespace-normal px-0 text-left"
            onClick={() => setShowHistory((value) => !value)}
            aria-pressed={showHistory}
          >
            {showHistory ? "Mostrar só acessos vigentes" : "Mostrar também acessos revogados e expirados"}
          </Button>
        </div>
      ) : null}

      <Dialog open={confirming !== null} onOpenChange={(value) => !value && !busy && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Encerrar este vínculo?</DialogTitle>
            <DialogDescription>
              Todos os acessos compartilhados com você são revogados agora e o dossiê fecha. Um
              novo vínculo só nasce de um novo convite aceito pela pessoa.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="secondary" disabled={busy} onClick={() => setConfirming(null)}>
              Manter vínculo
            </Button>
            <Button
              variant="destructive"
              disabled={busy}
              onClick={() => confirming && void end(confirming)}
            >
              Encerrar vínculo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
