"use client";

import { Copy, Link2, Share2, XCircle } from "lucide-react";
import { useCallback, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  INVITE_STATE_LABEL,
  INVITE_TTL_HOURS,
  inviteLink,
  type InviteState,
} from "@/lib/contracts/professional-invites";
import { formatDateTime, isLiveInvite, type PortalInvite } from "@/lib/professional/portal";
import { cn } from "@/lib/utils";

interface ApiInviteRow {
  id: string;
  state: InviteState;
  created_at: string;
  expires_at: string;
  opened_at: string | null;
  accepted_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
  relationship_id: string | null;
}

function fromApi(row: ApiInviteRow): PortalInvite {
  return {
    id: row.id,
    state: row.state,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    openedAt: row.opened_at,
    acceptedAt: row.accepted_at,
    consumedAt: row.consumed_at,
    revokedAt: row.revoked_at,
    relationshipId: row.relationship_id,
  };
}

function inviteOutcome(invite: PortalInvite, acceptedBy: string | undefined) {
  const at =
    invite.acceptedAt ?? invite.consumedAt ?? invite.revokedAt ?? (invite.state === "expired" ? invite.expiresAt : null);
  const label = invite.state === "accepted" && acceptedBy ? `Aceito por ${acceptedBy}` : INVITE_STATE_LABEL[invite.state];
  return at ? `${label} em ${formatDateTime(at)}` : label;
}

interface Created {
  inviteId: string;
  token: string;
  expiresAt: string;
}


export function InvitesPanel({
  verified,
  initialInvites,
  acceptedNames = {},
  environment = null,
}: {
  verified: boolean;
  initialInvites: PortalInvite[];
  acceptedNames?: Record<string, string>;
  environment?: "local" | "staging" | null;
}) {
  const [invites, setInvites] = useState<PortalInvite[]>(initialInvites);
  const [view, setView] = useState<"live" | "history">("live");
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<"código" | "link" | null>(null);

  const load = useCallback(async () => {
    const response = await fetch("/api/professional/invites", { cache: "no-store" });
    const payload = (await response.json()) as { data?: ApiInviteRow[]; error?: string };
    if (!response.ok || !payload.data) throw new Error(payload.error ?? "Convites indisponíveis.");
    setInvites(payload.data.map(fromApi));
  }, []);

  async function create() {
    setBusy("create");
    setError(null);
    setCopied(null);
    try {
      const response = await fetch("/api/professional/invites", { method: "POST", cache: "no-store" });
      const payload = (await response.json()) as { data?: Created; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error ?? "Não foi possível gerar o convite.");
      setCreated({ inviteId: payload.data.inviteId, token: payload.data.token, expiresAt: payload.data.expiresAt });
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível gerar o convite.");
    } finally {
      setBusy(null);
    }
  }

  async function revoke(id: string) {
    setBusy(id);
    setError(null);
    try {
      const response = await fetch(`/api/professional/invites?id=${id}`, { method: "DELETE" });
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "Não foi possível cancelar o convite.");
      if (created?.inviteId === id) setCreated(null);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Não foi possível cancelar o convite.");
    } finally {
      setBusy(null);
    }
  }

  async function copy(text: string, what: "código" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      setError("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  }

  async function share(code: string, url: string) {
    try {
      await navigator.share({
        title: "Convite na Elyra",
        text: `Use este código de convite na Elyra: ${code}. Ele vale por ${INVITE_TTL_HOURS} horas e só pode ser usado uma vez.`,
        url,
      });
    } catch {
      // Cancelar a folha de compartilhamento nao e erro.
    }
  }

  const live = invites.filter(isLiveInvite);
  const history = invites.filter((invite) => !isLiveInvite(invite));
  const shown = view === "live" ? live : history;
  const link = created ? inviteLink(window.location.origin, created.token) : null;
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h2">Convites</CardTitle>
        <CardDescription>
          Para quem você já acompanha fora da Elyra. O código vale por {INVITE_TTL_HOURS} horas e só pode ser usado
          uma vez. Aceitar cria o vínculo; nenhum dado é compartilhado automaticamente, e a pessoa decide depois o
          que mostrar.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {environment ? <p className="rounded-control bg-surface-muted p-3 text-sm text-ink-muted" data-testid="invite-environment">
          {environment === "local" ? "Ambiente local: este convite só funciona nesta instalação local. Para testar, profissional e pessoa devem usar o mesmo ambiente local. Ele não funciona no staging." : "Ambiente staging: este convite só funciona no staging. Profissional e pessoa devem acessar o mesmo ambiente."}
        </p> : null}
        {!verified ? (
          <p className="rounded-control bg-surface-muted px-4 py-3 text-sm text-ink-muted">
            Convites ficam disponíveis depois que seu registro for verificado.
          </p>
        ) : (
          <Button className="self-start" disabled={busy === "create"} onClick={() => void create()}>
            <Link2 aria-hidden="true" /> Gerar convite
          </Button>
        )}

        {created && link ? (
          <div className="rounded-control border border-line p-4" data-testid="invite-created">
            <p className="text-sm font-medium text-ink">Código de convite</p>
            <p
              className="mt-2 select-all break-all font-mono text-2xl font-semibold tracking-[0.12em] text-ink sm:text-3xl"
              data-testid="invite-code"
            >
              {created.token}
            </p>
            <p className="mt-2 text-xs text-ink-muted">
              Entregue à pessoa por um canal seu. Ele não será mostrado de novo. Válido até{" "}
              {formatDateTime(created.expiresAt)}.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" onClick={() => void copy(created.token, "código")}>
                <Copy aria-hidden="true" /> Copiar código
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void copy(link, "link")}>
                <Copy aria-hidden="true" /> Copiar link
              </Button>
              {canShare ? (
                <Button size="sm" variant="secondary" onClick={() => void share(created.token, link)}>
                  <Share2 aria-hidden="true" /> Compartilhar
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy === created.inviteId}
                onClick={() => void revoke(created.inviteId)}
              >
                <XCircle aria-hidden="true" /> Cancelar convite
              </Button>
            </div>
            {copied ? (
              <p role="status" className="mt-2 text-xs text-ink-muted">
                {copied === "código" ? "Código copiado." : "Link copiado."}
              </p>
            ) : null}
          </div>
        ) : null}

        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}

        <div role="group" aria-label="Quais convites mostrar" className="flex flex-wrap gap-2">
          {([
            ["live", "Em aberto", live.length],
            ["history", "Histórico", history.length],
          ] as const).map(([value, label, count]) => (
            <button
              key={value}
              type="button"
              aria-pressed={view === value}
              onClick={() => setView(value)}
              className={cn(
                "motion-press inline-flex min-h-11 items-center gap-1.5 rounded-pill border px-3.5 text-sm font-medium transition-colors",
                view === value
                  ? "border-brand-300 bg-surface-brand text-brand-700"
                  : "border-line bg-surface text-ink-muted hover:bg-surface-muted",
              )}
            >
              {label}
              <span className="tabular-nums text-xs text-ink-subtle">{count}</span>
            </button>
          ))}
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-ink-muted">
            {view === "live"
              ? "Nenhum convite aguardando uso."
              : "Nenhum convite encerrado ainda. Aceitos, recusados, cancelados e expirados ficam aqui por 30 dias."}
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-line" data-testid={`invites-${view}`}>
            {shown.map((invite) => (
              <li key={invite.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
                <div className="mr-auto min-w-0">
                  <p className="text-sm text-ink">Criado em {formatDateTime(invite.createdAt)}</p>
                  <p className="text-xs text-ink-muted">
                    {isLiveInvite(invite)
                      ? `Expira em ${formatDateTime(invite.expiresAt)}${invite.state === "opened" ? " · visto pela pessoa" : ""}`
                      : inviteOutcome(invite, invite.relationshipId ? acceptedNames[invite.relationshipId] : undefined)}
                  </p>
                </div>
                <Badge tone={invite.state === "accepted" ? "positive" : "neutral"}>
                  {INVITE_STATE_LABEL[invite.state]}
                </Badge>
                {isLiveInvite(invite) ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy === invite.id}
                    onClick={() => void revoke(invite.id)}
                  >
                    <XCircle aria-hidden="true" /> Cancelar convite
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
