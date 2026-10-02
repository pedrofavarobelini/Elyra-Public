"use client";

import {
  BellOff,
  Check,
  CheckCheck,
  ChevronRight,
  EyeOff,
  RefreshCw,
} from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useState } from "react";

import { EmptyState, InlineSpinner } from "@/components/states";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  NOTIFICATION_KIND_LABEL,
  notificationSnapshotSchema,
  type NotificationKind,
  type NotificationPreferences,
  type NotificationSnapshot,
} from "@/lib/contracts/notifications";
import { cn } from "@/lib/utils";
import { NotificationPreferencesCard } from "./notification-preferences";

/** Acao contextual por tipo. `system_notice` nao tem destino: ele so informa. */
const KIND_ACTION: Partial<Record<NotificationKind, { href: Route; label: string }>> = {
  checkin_reminder: { href: "/meu-humor", label: "Registrar agora" },
  goal_reminder: { href: "/metas", label: "Ver metas" },
  weekly_digest: { href: "/relatorios", label: "Ver relatórios" },
  // PRO-6: quem recebe "pedido" e sempre o profissional; os demais vao para a
  // agenda da pessoa, que aponta para a profissional quando for o caso.
  appointment_requested: { href: "/pro/agenda", label: "Abrir agenda" },
  appointment_confirmed: { href: "/agenda", label: "Ver sessão com profissional" },
  appointment_cancelled: { href: "/agenda", label: "Ver sessão com profissional" },
  appointment_reminder: { href: "/agenda", label: "Ver sessão com profissional" },
  session_ready: { href: "/agenda", label: "Ver sessão com profissional" },
  connection_requested: { href: "/pro/solicitacoes", label: "Ver solicitações" },
  relationship_created: { href: "/configuracoes/privacidade", label: "Escolher o que compartilhar" },
  professional_verification_update: { href: "/area-profissional", label: "Ver área profissional" },
  help_request_received: { href: "/pro/pedidos", label: "Ver recados" },
  help_request_updated: { href: "/pedidos", label: "Ver meus recados" },
  invite_accepted: { href: "/pro/vinculos", label: "Ver vínculos" },
};

type Filter = "all" | "unread" | NotificationKind;

function formatWhen(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function NotificationsView({
  initialSnapshot,
  inboxUnavailable,
  initialPreferences,
  preferencesUnavailable,
}: {
  initialSnapshot: NotificationSnapshot;
  inboxUnavailable: boolean;
  initialPreferences: NotificationPreferences;
  preferencesUnavailable: boolean;
}) {
  return (
    /*
     * O vazio inferior vinha de empilhar central (larga) e, sob ela, duas
     * colunas de alturas muito diferentes: a curta terminava cedo e deixava um
     * bloco morto do tamanho de um card.
     *
     * Aqui as colunas sao agrupadas por assunto, nao por sobra de espaco: a
     * esquerda le os avisos (a central e a nota que explica o que um aviso
     * mostra), a direita os controla (preferencias). Isso tambem aproxima as
     * duas alturas — a nota curta acompanha a central em vez de competir com um
     * painel de toggles — e a diferenca que resta fica no fim de uma coluna,
     * que e onde uma coluna termina, nao um buraco no meio da pagina. Nenhum
     * card e esticado e nenhum conteudo e inventado. Abaixo de `lg` tudo volta
     * a ser uma coluna so, na mesma ordem de leitura.
     */
    <div
      data-testid="notifications-layout"
      className="grid min-w-0 items-start gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
    >
      <div data-testid="notifications-main" className="grid min-w-0 content-start gap-5">
        <NotificationInbox
          initialSnapshot={initialSnapshot}
          initiallyUnavailable={inboxUnavailable}
        />
        <Card variant="muted">
          <CardHeader>
            <div className="flex items-start gap-3">
              <EyeOff className="mt-1 size-5 shrink-0 text-identity-600" aria-hidden="true" />
              <div className="min-w-0">
                <CardTitle as="h2">O que um aviso mostra</CardTitle>
                <CardDescription>
                  <strong className="font-medium text-ink">
                    Nenhum aviso traz seus registros.
                  </strong>{" "}
                  Fora da Elyra — e-mail, navegador, tela bloqueada — chega só o
                  convite, como “Lembrete de check-in”. Humor, diário e sessões
                  ficam dentro da conta.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="flex items-start gap-2 text-sm text-ink-muted">
              <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              Ainda não há horário silencioso. Para pausar um aviso, use “Adiar”
              ou desligue-o.
            </p>
          </CardContent>
        </Card>
      </div>

      <div data-testid="notifications-support-grid" className="grid min-w-0 content-start gap-5">
        <NotificationPreferencesCard
          initialPreferences={initialPreferences}
          initiallyUnavailable={preferencesUnavailable}
        />
      </div>
    </div>
  );
}

function NotificationInbox({
  initialSnapshot,
  initiallyUnavailable,
}: {
  initialSnapshot: NotificationSnapshot;
  initiallyUnavailable: boolean;
}) {
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [error, setError] = useState(initiallyUnavailable);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const refresh = async () => {
    const response = await fetch("/api/notifications", {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("notifications_unavailable");
    const payload = (await response.json()) as { data?: unknown };
    setSnapshot(notificationSnapshotSchema.parse(payload.data));
  };

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(false);
    try {
      await task();
      await refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(null);
    }
  };

  const markOne = async (id: string) => {
    const response = await fetch(`/api/notifications/${id}`, {
      method: "PATCH",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("notification_update_failed");
  };

  const unread = snapshot.notifications.filter((item) => item.readAt === null);
  // So oferece o filtro de um tipo quando ha aviso daquele tipo na lista.
  const kinds = [...new Set(snapshot.notifications.map((item) => item.kind))];
  const filters: { value: Filter; label: string }[] = [
    { value: "all", label: "Todas" },
    { value: "unread", label: `Não lidas${snapshot.unreadCount > 0 ? ` (${snapshot.unreadCount})` : ""}` },
    ...kinds.map((kind) => ({ value: kind, label: NOTIFICATION_KIND_LABEL[kind] })),
  ];
  const visible = snapshot.notifications.filter((item) =>
    filter === "all" ? true : filter === "unread" ? item.readAt === null : item.kind === filter,
  );

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle as="h2">Central</CardTitle>
            <CardDescription>
              {snapshot.notifications.length > 0
                ? "Os 20 avisos mais recentes."
                : "Avisos aparecem aqui conforme suas preferências."}
            </CardDescription>
          </div>
          {unread.length > 0 ? (
            <Button
              variant="soft"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run("all", async () => {
                  for (const item of unread) await markOne(item.id);
                })
              }
            >
              {busy === "all" ? (
                <InlineSpinner />
              ) : (
                <CheckCheck aria-hidden="true" />
              )}
              Marcar todas como lidas
            </Button>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {snapshot.notifications.length > 0 ? (
          <div role="group" aria-label="Filtrar notificações" className="flex flex-wrap gap-2">
            {filters.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
                className={cn(
                  "motion-press inline-flex min-h-11 items-center rounded-pill border px-3.5 text-sm font-medium transition-colors lg:min-h-9",
                  filter === value
                    ? "border-brand-300 bg-brand-100 text-brand-700"
                    : "border-line bg-surface text-ink-muted hover:border-brand-200 hover:text-ink",
                )}
              >
                {label}
              </button>
            ))}
          </div>
        ) : null}

        <div aria-live="polite">
          {error ? (
            <div role="alert" className="rounded-control border border-line bg-surface-muted p-4">
              <p className="text-sm text-ink">Não foi possível carregar as notificações.</p>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => void run("refresh", async () => {})}
              >
                <RefreshCw aria-hidden="true" />
                Tentar novamente
              </Button>
            </div>
          ) : visible.length === 0 ? (
            <EmptyState
              size="compact"
              title={
                snapshot.notifications.length === 0
                  ? "Nenhuma notificação por enquanto"
                  : "Nada neste filtro"
              }
              description={
                snapshot.notifications.length === 0
                  ? "Quando um lembrete ligado estiver disponível, ele aparece aqui."
                  : "Troque o filtro para ver os demais avisos."
              }
            />
          ) : (
            <ul className="flex flex-col gap-3">
              {visible.map((item) => {
                const isUnread = item.readAt === null;
                const action = KIND_ACTION[item.kind];
                return (
                  <li
                    key={item.id}
                    className={cn(
                      "rounded-card border p-4",
                      isUnread ? "border-brand-200 bg-surface-brand" : "border-line bg-surface",
                    )}
                  >
                    <article className="flex flex-col gap-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-sm font-semibold text-ink">{item.title}</h3>
                          <p className="mt-1 text-sm text-ink-muted">{item.message}</p>
                        </div>
                        {isUnread ? (
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-brand-700">
                            <span className="size-2 rounded-full bg-brand-600" aria-hidden="true" />
                            Não lida
                          </span>
                        ) : (
                          <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-xs text-positive">
                            <Check className="size-3.5" aria-hidden="true" />
                            Lida
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <time className="text-xs text-ink-subtle" dateTime={item.createdAt}>
                          {formatWhen(item.createdAt)}
                        </time>
                        <div className="flex flex-wrap items-center gap-1">
                          {isUnread ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy !== null}
                              onClick={() => void run(item.id, () => markOne(item.id))}
                            >
                              {busy === item.id ? (
                                <InlineSpinner />
                              ) : (
                                <Check aria-hidden="true" />
                              )}
                              Marcar como lida
                            </Button>
                          ) : null}
                          {action ? (
                            <Button asChild variant="link" size="sm">
                              <Link href={action.href}>
                                {action.label}
                                <ChevronRight aria-hidden="true" />
                              </Link>
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
