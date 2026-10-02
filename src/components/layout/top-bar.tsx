"use client";

import { Bell } from "lucide-react";
import Link from "next/link";

import { BrandHomeLink } from "@/components/layout/brand-home-link";
import type { NavContext } from "@/components/layout/nav-config";
import { NavDrawer } from "@/components/layout/nav-drawer";
import { NotificationBell } from "@/components/layout/notification-bell";
import { SyncIndicator } from "@/components/offline/sync-status";
import { useScrollHide } from "@/components/layout/use-scroll-hide";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import type { NotificationSnapshot } from "@/lib/contracts/notifications";
import { cn } from "@/lib/utils";

export interface TopBarProps {
  context?: NavContext;
  userInitials?: string;
  notificationSnapshot?: NotificationSnapshot;
  notificationsInitiallyUnavailable?: boolean;

  showContextSwitcher?: boolean;
}

/**
 * Barra superior da area principal.
 *
 * Abaixo de `lg`: gatilho do drawer, simbolo da marca, notificacoes e conta —
 * o que precisa estar sempre a um toque no celular.
 *
 * A partir de `lg` a navegacao e a marca moram na sidebar (ADR-0013); aqui
 * sobram notificacoes e conta, sem borda nem fundo, para o conteudo comecar
 * logo abaixo em vez de competir com uma segunda faixa.
 */
export function TopBar({
  context = "user",
  userInitials = "P",
  notificationSnapshot,
  notificationsInitiallyUnavailable = false,
  showContextSwitcher = false,
}: TopBarProps) {
  const hidden = useScrollHide("elyra-top-bar");

  return (
    <header
      id="elyra-top-bar"
      data-scroll-hidden={hidden || undefined}
      className={cn(
        "sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md lg:static lg:border-transparent lg:bg-transparent lg:backdrop-blur-none",
        "transition-transform duration-[var(--duration-normal)] ease-[var(--ease-standard)] will-change-transform lg:transition-none",
        hidden && "-translate-y-full lg:translate-y-0",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[100rem] items-center gap-1 px-2 sm:px-4 lg:h-16 lg:px-8 2xl:px-10">
        <NavDrawer context={context} userInitials={userInitials} showContextSwitcher={showContextSwitcher} />

        <BrandHomeLink variant="symbol" priority className="lg:hidden" />

        <div className="flex-1" />

        <div className="flex min-w-0 shrink items-center gap-1 sm:gap-2">
          {/* Stage 25: aparece so quando ha algo a dizer sobre rede ou fila. */}
          <SyncIndicator />
          {notificationSnapshot ? (
            <NotificationBell
              initialSnapshot={notificationSnapshot}
              initiallyUnavailable={notificationsInitiallyUnavailable}
            />
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex size-11 items-center justify-center rounded-control text-ink-subtle"
              aria-label="Notificações indisponíveis nesta demonstração"
            >
              <Bell className="size-5" aria-hidden="true" />
            </button>
          )}

          <Link
            href={context === "user" ? "/perfil" : "/pro/perfil"}
            className="motion-press inline-flex size-11 items-center justify-center rounded-pill transition-opacity hover:opacity-90"
            aria-label="Menu da conta"
          >
            <Avatar className="size-9 ring-2 ring-surface">
              <AvatarFallback className="bg-brand-100 text-xs font-semibold text-brand-700">
                {userInitials}
              </AvatarFallback>
            </Avatar>
          </Link>
        </div>
      </div>
    </header>
  );
}
