"use client";

import { Bell, Check, RefreshCw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import {
  notificationSnapshotSchema,
  type NotificationSnapshot,
} from "@/lib/contracts/notifications";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { InlineSpinner, InlineLoading } from "@/components/states";

interface NotificationBellProps {
  initialSnapshot: NotificationSnapshot;
  initiallyUnavailable?: boolean;
}

/** Data completa (dd/mm/aaaa): a notificacao pode ser de outro ano. */
function formatDataCompleta(iso: string) {
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function NotificationBell({
  initialSnapshot,
  initiallyUnavailable = false,
}: NotificationBellProps) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(initiallyUnavailable);
  const [markingId, setMarkingId] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/notifications", {
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("notifications_unavailable");
      const payload = (await response.json()) as { data?: unknown };
      setSnapshot(notificationSnapshotSchema.parse(payload.data));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const markAsRead = async (id: string) => {
    setMarkingId(id);
    setError(false);
    try {
      const response = await fetch(`/api/notifications/${id}`, {
        method: "PATCH",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("notification_update_failed");
      await refresh();
    } catch {
      setError(true);
    } finally {
      setMarkingId(null);
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) void refresh();
  };

  const count = snapshot.unreadCount;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <button
          type="button"
          className="relative inline-flex size-11 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface hover:text-ink lg:size-10"
          aria-label={
            count > 0
              ? `Notificações: ${count} não lidas`
              : "Notificações"
          }
        >
          <Bell className="size-5" aria-hidden="true" />
          {count > 0 ? (
            <span className="absolute right-1 top-1 flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-pill bg-brand-600 px-1 text-xs font-semibold leading-none text-white ring-2 ring-canvas">
              {count > 9 ? "9+" : count}
            </span>
          ) : null}
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Notificações</DialogTitle>
          <DialogDescription>
            Lembretes in-app controlados pelas suas preferências.
          </DialogDescription>
        </DialogHeader>

        <div aria-live="polite">
          {loading ? (
            <InlineLoading className="py-8">Carregando notificações...</InlineLoading>
          ) : error ? (
            <div role="alert" className="rounded-control border border-line bg-surface-muted p-4">
              <p className="text-sm text-ink">Não foi possível carregar as notificações.</p>
              <button
                type="button"
                onClick={() => void refresh()}
                className="mt-3 inline-flex items-center gap-2 rounded-control border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-surface-brand"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Tentar novamente
              </button>
            </div>
          ) : snapshot.notifications.length === 0 ? (
            <p className="rounded-control bg-surface-muted px-4 py-8 text-center text-sm text-ink-muted">
              Nenhuma notificação por enquanto.
            </p>
          ) : (
            <ul className="max-h-[55vh] space-y-3 overflow-y-auto pr-1">
              {snapshot.notifications.map((notification) => {
                const unread = notification.readAt === null;
                return (
                  <li
                    key={notification.id}
                    className={cn(
                      "rounded-control border p-4",
                      unread
                        ? "border-brand-200 bg-surface-brand"
                        : "border-line bg-surface",
                    )}
                  >
                    <article>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <h3 className="text-sm font-semibold text-ink">
                            {notification.title}
                          </h3>
                          <p className="mt-1 text-sm text-ink-muted">
                            {notification.message}
                          </p>
                        </div>
                        {unread ? (
                          <span className="mt-1 size-2 shrink-0 rounded-full bg-brand-600" aria-label="Não lida" />
                        ) : null}
                      </div>
                      <div className="mt-3 flex items-center justify-between gap-3">
                        <time className="text-xs text-ink-subtle" dateTime={notification.createdAt}>
                          {formatDataCompleta(notification.createdAt)}
                        </time>
                        {unread ? (
                          <button
                            type="button"
                            disabled={markingId === notification.id}
                            onClick={() => void markAsRead(notification.id)}
                            className="inline-flex items-center gap-1.5 rounded-control px-2 py-1 text-xs font-medium text-brand-700 hover:bg-surface disabled:cursor-wait disabled:opacity-60"
                          >
                            {markingId === notification.id ? (
                              <InlineSpinner size="sm" />
                            ) : (
                              <Check className="size-3.5" aria-hidden="true" />
                            )}
                            Marcar como lida
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-xs text-positive">
                            <Check className="size-3.5" aria-hidden="true" />
                            Lida
                          </span>
                        )}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* R2: a central completa (filtros e preferencias) mora em /notificacoes. */}
        <Link
          href="/notificacoes"
          onClick={() => setOpen(false)}
          className="motion-press mt-4 flex min-h-11 items-center justify-center rounded-control border border-line text-sm font-medium text-brand-700 transition-colors hover:bg-surface-brand"
        >
          Abrir central e preferências
        </Link>
      </DialogContent>
    </Dialog>
  );
}
