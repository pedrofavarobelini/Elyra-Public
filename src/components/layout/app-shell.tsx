import type * as React from "react";

import { SosButton } from "@/components/help/sos-button";
import { ContextArrival } from "@/components/layout/context-arrival";
import { OfflineBanner } from "@/components/layout/offline-banner";
import { ServiceWorkerRegistrar } from "@/components/layout/service-worker-registrar";
import { Sidebar } from "@/components/layout/sidebar";
import { TopBar, type TopBarProps } from "@/components/layout/top-bar";
import { cn } from "@/lib/utils";

export interface AppShellProps extends TopBarProps {
  children: React.ReactNode;
  className?: string;
}


export function AppShell({ children, className, ...topBar }: AppShellProps) {
  return (
    <div data-elyra-shell="app" className="elyra-canvas min-h-dvh lg:grid lg:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
      <a
        href="#conteudo"
        className="sr-only-focusable absolute left-4 top-4 z-50 rounded-control bg-brand-600 px-4 py-2 text-sm text-white"
      >
        Pular para o conteúdo
      </a>

      <Sidebar context={topBar.context} showContextSwitcher={topBar.showContextSwitcher} />

      <div className="flex min-w-0 flex-col">
        <TopBar {...topBar} />

        {/*
          Entre a barra e o conteudo, e nao dentro de cada tela: a queda de rede
          nao pertence a nenhuma jornada em particular.
        */}
        <OfflineBanner />

        {/* MOTION-2: diz onde a pessoa esta so quando a area MUDOU. */}
        <ContextArrival context={topBar.context ?? "user"} />

        {/*
          O registro do worker vive no shell autenticado: e aqui que a pessoa
          efetivamente usa o produto, e `/dashboard` e o `start_url` do manifest.
        */}
        <ServiceWorkerRegistrar />

        <main
          id="conteudo"
          className={cn(
            "motion-page mx-auto w-full max-w-[100rem] flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-24 lg:pt-1 2xl:px-10",
            className,
          )}
        >
          {children}
        </main>
      </div>

      {/*
        Ajuda imediata so na area de quem usa a Elyra para si. A area
        profissional nao recebe o botao: la ele sugeriria um canal de
        atendimento que a Elyra nao oferece.
        `pb-24` no main: o botao fixo nunca cobre o fim do conteudo.
      */}
      {topBar.context === "professional" ? null : <SosButton />}
    </div>
  );
}
