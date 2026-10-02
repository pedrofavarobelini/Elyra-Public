"use client";

import { CalendarDays, Link2Off } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { RequiresConnection } from "@/components/offline/requires-connection";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  describeDataWindow,
  grantIsCurrent,
  PROFESSIONAL_TRAIL_EVENT_LABEL,
  RELATIONSHIP_STATUS_LABEL,
  type RelationshipStatus,
  type SharingScope,
} from "@/lib/contracts/sharing";
import { InlineEmpty } from "@/components/states";

interface Connection {
  id: string;
  client_user_id: string;
  professional_user_id: string;
  professional_name?: string | null;
  status: RelationshipStatus;
}

interface AccessLogRow {
  id: string;
  connection_id: string;
  professional_user_id: string;
  scope: SharingScope | null;
  event_type: string;
  actor_role: "professional" | "client";
  occurred_at: string;
}

interface Permission {
  id: string;
  connection_id: string;
  scope: SharingScope;
  journal_entry_id: string | null;
  status: "granted" | "revoked";
  expires_at: string | null;
  valid_from: string | null;
  revoked_at: string | null;
  data_from: string | null;
  data_to: string | null;
}

const SCOPE_LABEL: Record<Exclude<SharingScope, "journal_entry">, string> = {
  emotional: "Humor",
  sleep: "Sono",
  goals: "Metas",
  cycle: "Ciclo",
  reports: "Relatórios",
  multimodal_result: "Resultado",
  multimodal_transcript: "Transcrição",
  multimodal_ai_interpretation: "Interpretação por IA",
  multimodal_media: "Gravação",
};

/**
 * Dois grupos, porque sao dois modelos (L-398):
 * - Registros: permissao persistente do vinculo, e basta.
 * - Sessoes particulares: a permissao do vinculo **e** a decisao de cada
 *   sessao precisam permitir (dupla chave, conferida no RLS:
 *   `share_*_consent` da sessao AND `professional_access_allowed(...)`).
 */
export const SCOPE_GROUPS: ReadonlyArray<{
  id: string;
  title: string;
  note?: string;
  scopes: ReadonlyArray<Exclude<SharingScope, "journal_entry">>;
}> = [
  { id: "registros", title: "Registros", scopes: ["emotional", "sleep", "goals", "cycle", "reports"] },
  {
    id: "sessoes",
    title: "Sessões particulares",
    note: "Cada sessão particular também pergunta o que você quer compartilhar naquela sessão. As duas permissões precisam permitir o acesso.",
    scopes: ["multimodal_result", "multimodal_transcript", "multimodal_media", "multimodal_ai_interpretation"],
  },
];

async function readJson<T>(response: Response): Promise<T> {
  const payload = (await response.json()) as { data?: T; error?: string };
  if (!response.ok || payload.data === undefined) {
    throw new Error(payload.error ?? "Operação de compartilhamento indisponível.");
  }
  return payload.data;
}

function permissionIsCurrent(permission: Permission) {
  return grantIsCurrent(permission);
}

function scopeLabel(scope: SharingScope) {
  return scope === "journal_entry" ? "Diário" : SCOPE_LABEL[scope];
}

export function ProfessionalSharing({
  currentUserId,
  journalEntries,
}: {
  currentUserId: string;
  journalEntries: Array<{ id: string; title: string | null }>;
}) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [permissions, setPermissions] = useState<Record<string, Permission[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acessos, setAcessos] = useState<AccessLogRow[]>([]);

  const loadPermissions = useCallback(async (connectionId: string) => {
    const rows = await readJson<Permission[]>(
      await fetch(`/api/professional/permissions?connectionId=${connectionId}`),
    );
    setPermissions((current) => ({ ...current, [connectionId]: rows }));
  }, []);

  /**
   * A trilha de acesso nao recebe id de usuario: a RLS ja devolve so as linhas
   * do titular. Pedir um id daria a alguem um lugar para passar o de outra
   * pessoa - o formato exato do defeito de `L-058`.
   */
  const loadAccessLog = useCallback(async () => {
    setAcessos(
      await readJson<AccessLogRow[]>(await fetch("/api/professional/access-log")),
    );
  }, []);

  const loadConnections = useCallback(async () => {
    const rows = await readJson<Connection[]>(
      await fetch("/api/professional/connections"),
    );
    const owned = rows.filter(
      (connection) => connection.client_user_id === currentUserId,
    );
    setConnections(owned);
    await Promise.all(
      owned
        // Pausada tambem: a pessoa pode preparar o que compartilhar antes de
        // retomar. A leitura continua negada no banco enquanto estiver pausada.
        .filter((connection) => connection.status === "active" || connection.status === "paused")
        .map((connection) => loadPermissions(connection.id)),
    );
  }, [currentUserId, loadPermissions]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void Promise.all([loadConnections(), loadAccessLog()]).catch((caught) => {
        setError(
          caught instanceof Error ? caught.message : "Não foi possível carregar.",
        );
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAccessLog, loadConnections]);

  async function setPermission(
    connectionId: string,
    scope: SharingScope,
    enabled: boolean,
    journalEntryId?: string,
  ) {
    const target = `${connectionId}:${scope}:${journalEntryId ?? "all"}`;
    setBusy(target);
    setError(null);
    try {
      await readJson(
        await fetch("/api/professional/permissions", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            connectionId,
            scope,
            enabled,
            ...(journalEntryId ? { journalEntryId } : {}),
          }),
        }),
      );
      await loadPermissions(connectionId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível atualizar.",
      );
    } finally {
      setBusy(null);
    }
  }

  /**
   * Recorta o periodo do dado de um escopo ja concedido.
   *
   * Verbo separado do de conceder porque sao decisoes distintas: estreitar a
   * janela nao deve revogar, e revogar nao deve mexer na janela.
   */
  async function setWindow(
    connectionId: string,
    scope: SharingScope,
    dataFrom: string | null,
    dataTo: string | null,
  ) {
    const target = `${connectionId}:${scope}:window`;
    setBusy(target);
    setError(null);
    try {
      await readJson(
        await fetch("/api/professional/permissions", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId, scope, dataFrom, dataTo }),
        }),
      );
      await loadPermissions(connectionId);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível atualizar.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function changeRelationship(connectionId: string, action: "pause" | "resume") {
    setBusy(`${connectionId}:${action}`);
    setError(null);
    try {
      await readJson(
        await fetch("/api/professional/connections", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId, action }),
        }),
      );
      await Promise.all([loadConnections(), loadAccessLog()]);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível atualizar o vínculo.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function revoke(connectionId: string) {
    setBusy(`${connectionId}:revoke`);
    setError(null);
    try {
      await readJson(
        await fetch("/api/professional/connections", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ connectionId, action: "revoke" }),
        }),
      );
      await loadConnections();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Não foi possível revogar.",
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compartilhamento com profissional</CardTitle>
        <CardDescription>
          Tudo nasce desligado. Você decide, item por item, o que cada profissional vê — e pode mudar a qualquer momento.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        <RequiresConnection>
        <p
          className={
            connections.length === 0
              ? "inline-flex w-fit items-center gap-2 rounded-pill bg-surface-muted px-3 py-1 text-xs font-medium text-ink-muted"
              : "inline-flex w-fit items-center gap-2 rounded-pill bg-positive-soft px-3 py-1 text-xs font-medium text-positive"
          }
        >
          <span
            aria-hidden="true"
            className={connections.length === 0 ? "size-1.5 rounded-pill bg-ink-subtle" : "size-1.5 rounded-pill bg-positive"}
          />
          {connections.length === 0
            ? "Nenhum profissional conectado"
            : connections.length === 1
              ? "1 conexão"
              : `${connections.length} conexões`}
        </p>

        {/*
          Stage 29 / PRO-2: o vinculo nasce de um convite do profissional (token
          de uso unico), e nao mais do UUID digitado aqui.
        */}
        <p className="text-sm text-ink-muted">
          Recebeu um código de um profissional?{" "}
          <Link className="font-medium text-brand underline-offset-4 hover:underline" href="/convite?returnTo=%2Fconfiguracoes%2Fprivacidade">
            Tenho um código de convite
          </Link>
          {" · "}
          <Link className="font-medium text-brand underline-offset-4 hover:underline" href="/profissionais">
            Encontrar profissional
          </Link>
        </p>

        {connections.length > 0 ? (
          /*
            L-398: resumo no topo — "quem pode acessar o que agora". Mesma fonte
            dos interruptores abaixo (permissao vigente), nunca um texto a parte.
          */
          <section aria-labelledby="sharing-summary-title" className="rounded-control border border-line bg-surface-muted/50 p-4" data-testid="sharing-summary">
            <h3 id="sharing-summary-title" className="text-sm font-semibold text-ink">
              Quem pode acessar o quê agora
            </h3>
            <ul className="mt-2 flex flex-col gap-2">
              {connections.map((connection) => {
                const granted = (permissions[connection.id] ?? []).filter(
                  (permission) => permission.journal_entry_id === null && permissionIsCurrent(permission),
                );
                const diary = (permissions[connection.id] ?? []).filter(
                  (permission) => permission.journal_entry_id !== null && permissionIsCurrent(permission),
                ).length;
                const labels = granted.map((permission) => scopeLabel(permission.scope));
                const text =
                  connection.status === "pending"
                    ? "Solicitação aguardando resposta — nada compartilhado."
                    : connection.status === "paused"
                      ? "Vínculo pausado — não acessa nada agora."
                      : labels.length === 0 && diary === 0
                        ? "Vínculo ativo — nada compartilhado ainda."
                        : `Pode ver: ${[...labels, ...(diary > 0 ? [`${diary} ${diary === 1 ? "entrada" : "entradas"} do diário`] : [])].join(", ")}.`;
                return (
                  <li key={connection.id} className="text-sm" data-testid="sharing-summary-item">
                    <span className="font-medium text-ink">{connection.professional_name ?? "Profissional"}</span>
                    <span className="text-ink-muted"> · {text}</span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {error ? (
          <p role="alert" className="text-sm text-destructive">{error}</p>
        ) : null}

        {connections.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Nenhuma conexão. Sem conexão, todas as consultas profissionais são negadas.
          </p>
        ) : (
          <ul className="flex flex-col gap-6">
            {connections.map((connection) => (
              <ConnectionPermissions
                key={connection.id}
                connection={connection}
                permissions={permissions[connection.id] ?? []}
                journalEntries={journalEntries}
                busy={busy}
                onPermission={setPermission}
                onWindow={setWindow}
                onRelationship={changeRelationship}
                onRevoke={revoke}
              />
            ))}
          </ul>
        )}

        <section aria-labelledby="acessos-titulo" className="border-t border-line pt-6">
          <h3 id="acessos-titulo" className="text-sm font-semibold text-ink">
            Quem acessou seus dados
          </h3>
          <p className="mt-1 text-xs text-ink-muted">
            Guarda quem, qual domínio e quando — nunca o que foi lido. Inclui
            quando o vínculo ou um compartilhamento mudou, e quem mudou.
          </p>

          {acessos.length === 0 ? (
            /*
              Tres silencios diferentes, e este e o terceiro: nao e "sem
              permissao" nem "dado insuficiente", e "ninguem abriu ainda".
              A frase precisa dizer isso, e nao deixar a pessoa supor que a
              tela quebrou.
            */
            <p className="mt-3 text-sm text-ink-subtle" data-testid="acessos-vazio">
              Nenhum acesso registrado até agora.
            </p>
          ) : (
            <ul className="mt-3 flex flex-col divide-y divide-line">
              {acessos.map((acesso) => (
                <li
                  key={acesso.id}
                  className="flex flex-wrap items-baseline justify-between gap-2 py-2"
                >
                  <span className="text-sm text-ink">
                    {PROFESSIONAL_TRAIL_EVENT_LABEL[acesso.event_type] ?? "Evento"}
                    {acesso.scope ? ` · ${scopeLabel(acesso.scope)}` : null}
                  </span>
                  <span className="text-xs text-ink-muted">
                    {new Date(acesso.occurred_at).toLocaleString("pt-BR")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
        </RequiresConnection>
      </CardContent>
    </Card>
  );
}

function ConnectionPermissions({
  connection,
  permissions,
  journalEntries,
  busy,
  onPermission,
  onWindow,
  onRelationship,
  onRevoke,
}: {
  connection: Connection;
  permissions: Permission[];
  journalEntries: Array<{ id: string; title: string | null }>;
  busy: string | null;
  onPermission: (
    connectionId: string,
    scope: SharingScope,
    enabled: boolean,
    journalEntryId?: string,
  ) => Promise<void>;
  onWindow: (
    connectionId: string,
    scope: SharingScope,
    dataFrom: string | null,
    dataTo: string | null,
  ) => Promise<void>;
  onRelationship: (connectionId: string, action: "pause" | "resume") => Promise<void>;
  onRevoke: (connectionId: string) => Promise<void>;
}) {
  const enabled = (scope: SharingScope, journalEntryId?: string) =>
    permissions.some(
      (permission) =>
        permission.scope === scope &&
        permission.journal_entry_id === (journalEntryId ?? null) &&
        permissionIsCurrent(permission),
    );

  const vigente = (scope: SharingScope) =>
    permissions.find(
      (permission) =>
        permission.scope === scope &&
        permission.journal_entry_id === null &&
        permissionIsCurrent(permission),
    );

  return (
    <li className="rounded-control border border-line p-4">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <p className="text-sm font-medium text-ink">
            {connection.professional_name ?? "Profissional"}
          </p>
          {connection.status === "pending" ? (
            <p className="text-xs text-ink-muted">
              Aguardando o profissional responder. Nada é compartilhado por pedir.
            </p>
          ) : null}
        </div>
        <Badge tone={connection.status === "active" ? "positive" : "neutral"}>
          {RELATIONSHIP_STATUS_LABEL[connection.status]}
        </Badge>
        {connection.status === "active" ? (
          // PRO-6: a agenda so existe com vinculo ativo; pausado nao marca horario.
          <Button asChild size="sm" variant="secondary">
            <Link href={`/agenda?vinculo=${connection.id}`}>
              <CalendarDays aria-hidden="true" /> Agenda
            </Link>
          </Button>
        ) : null}
        {connection.status === "active" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === `${connection.id}:pause`}
            onClick={() => void onRelationship(connection.id, "pause")}
          >
            Pausar
          </Button>
        ) : null}
        {connection.status === "paused" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === `${connection.id}:resume`}
            onClick={() => void onRelationship(connection.id, "resume")}
          >
            Retomar
          </Button>
        ) : null}
        {connection.status !== "revoked" && connection.status !== "ended" ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={busy === `${connection.id}:revoke`}
            onClick={() => void onRevoke(connection.id)}
          >
            <Link2Off aria-hidden="true" />{" "}
            {/* L-398: pedido pendente se cancela; vinculo existente se encerra. "Revogar" fica para cada compartilhamento. */}
            {connection.status === "pending" ? "Cancelar solicitação" : "Encerrar vínculo"}
          </Button>
        ) : null}
      </div>

      {connection.status === "paused" ? (
        <p className="mb-3 rounded-control bg-surface-muted px-3 py-2 text-xs text-ink-muted">
          Vínculo pausado: o profissional não acessa nada enquanto você não retomar.
          Os compartilhamentos abaixo ficam guardados.
        </p>
      ) : null}
      {connection.status === "active" || connection.status === "paused" ? (
        <div className="grid gap-5 lg:grid-cols-2">
          {SCOPE_GROUPS.map((group) => (
          <section key={group.id} aria-labelledby={`grupo-${connection.id}-${group.id}`} data-testid={`sharing-group-${group.id}`} className="min-w-0">
            <h4 id={`grupo-${connection.id}-${group.id}`} className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">
              {group.title}
            </h4>
            {group.note ? <p className="mt-1 text-xs text-ink-muted" data-testid="sharing-double-key">{group.note}</p> : null}
            <div className="flex flex-col divide-y divide-line">
          {group.scopes.map((scope) => {
            const target = `${connection.id}:${scope}:all`;
            const atual = vigente(scope);
            return (
              <div key={scope} className="py-3">
                <div className="flex items-center justify-between gap-4">
                  <Label htmlFor={`permission-${target}`}>{SCOPE_LABEL[scope]}</Label>
                  <Switch
                    id={`permission-${target}`}
                    checked={enabled(scope)}
                    disabled={busy === target}
                    onCheckedChange={(on) =>
                      void onPermission(connection.id, scope, on)
                    }
                  />
                </div>

                {/*
                  A janela so aparece com o escopo concedido: oferecer recorte de
                  algo que ninguem pode ver sugeriria uma protecao que nao existe.
                */}
                {atual ? (
                  <>
                  <p className="mt-1 text-xs text-ink-subtle" data-testid={`window-summary-${scope}`}>
                    {describeDataWindow(atual.data_from, atual.data_to)}
                  </p>
                  <Disclosure summary="Limitar período">
                  <fieldset className="mt-2 rounded-control border border-line p-3">
                    <legend className="px-1 text-xs font-medium text-ink-muted">
                      Período dos registros
                    </legend>
                    <div className="flex flex-wrap items-end gap-3">
                      <div>
                        <Label
                          htmlFor={`window-from-${target}`}
                          className="text-xs"
                        >
                          De
                        </Label>
                        <Input
                          id={`window-from-${target}`}
                          type="date"
                          defaultValue={atual.data_from ?? ""}
                          onBlur={(event) =>
                            void onWindow(
                              connection.id,
                              scope,
                              event.target.value || null,
                              atual.data_to,
                            )
                          }
                        />
                      </div>
                      <div>
                        <Label
                          htmlFor={`window-to-${target}`}
                          className="text-xs"
                        >
                          Até
                        </Label>
                        <Input
                          id={`window-to-${target}`}
                          type="date"
                          defaultValue={atual.data_to ?? ""}
                          onBlur={(event) =>
                            void onWindow(
                              connection.id,
                              scope,
                              atual.data_from,
                              event.target.value || null,
                            )
                          }
                        />
                      </div>
                      {atual.data_from || atual.data_to ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={busy === `${connection.id}:${scope}:window`}
                          onClick={() =>
                            void onWindow(connection.id, scope, null, null)
                          }
                        >
                          Compartilhar todo o histórico
                        </Button>
                      ) : null}
                    </div>
                    <p className="mt-2 text-xs text-ink-subtle">
                      Deixar em branco não restringe aquele lado. O recorte vale
                      no banco de dados, e não apenas nesta tela.
                    </p>
                  </fieldset>
                  </Disclosure>
                  </>
                ) : null}
              </div>
            );
          })}
            </div>
          </section>
          ))}
          <div className="py-3 lg:col-span-2">
            <p className="text-sm font-medium text-ink">Diário, entrada por entrada</p>
            <p className="mb-2 text-xs text-ink-muted">
              Não existe permissão global para o diário.
            </p>
            {journalEntries.length === 0 ? (
              <InlineEmpty>Nenhuma entrada disponível.</InlineEmpty>
            ) : (
              <ul className="flex flex-col gap-2">
                {journalEntries.map((entry) => {
                  const target = `${connection.id}:journal_entry:${entry.id}`;
                  return (
                    <li key={entry.id} className="flex items-center justify-between gap-4">
                      <Label htmlFor={`permission-${target}`}>
                        {entry.title || "Sem título"}
                      </Label>
                      <Switch
                        id={`permission-${target}`}
                        checked={enabled("journal_entry", entry.id)}
                        disabled={busy === target}
                        onCheckedChange={(on) =>
                          void onPermission(
                            connection.id,
                            "journal_entry",
                            on,
                            entry.id,
                          )
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </li>
  );
}
