import { LockKeyhole, ShieldCheck } from "lucide-react";

import { BrandHomeLink } from "@/components/layout/brand-home-link";
import { ContextSwitcher } from "@/components/layout/context-switcher";
import type { NavContext } from "@/components/layout/nav-config";
import { NavList } from "@/components/layout/nav-list";


export function Sidebar({
  context = "user",
  showContextSwitcher = false,
}: {
  context?: NavContext;
  showContextSwitcher?: boolean;
}) {
  const professional = context === "professional";

  return (
    <aside data-elyra-sidebar className="sticky top-0 hidden h-dvh flex-col border-r border-line bg-surface/80 backdrop-blur-sm lg:flex">
      <div className="sidebar-brand-row flex h-20 shrink-0 items-center px-6">
        <BrandHomeLink
          priority
          className="sidebar-brand-full"
          logoClassName="h-9"
          ringClassName="!right-auto aspect-square !h-[calc(100%+12px)] !w-auto"
        />
        {/* Navegacao compacta: o simbolo cabe na trilha de 5rem. */}
        <BrandHomeLink variant="symbol" className="sidebar-brand-symbol" logoClassName="h-8" />
      </div>

      {/*
        Stage 29 / AUTH-CONTEXT: onde ja ficava o selo "Area profissional" fica
        o seletor de area - mesma conta, outra area. Sem perfil profissional, o
        contexto pessoal nao mostra nada aqui.
      */}
      {showContextSwitcher ? (
        <div className="mx-3 mb-2">
          <ContextSwitcher context={context} />
        </div>
      ) : professional ? (
        <p className="sidebar-context-badge mx-6 mb-2 inline-flex w-fit items-center gap-1.5 rounded-pill bg-identity-50 px-2.5 py-1 text-xs font-medium text-identity-700">
          Área profissional
        </p>
      ) : null}

      <nav
        aria-label="Navegação principal"
        className="flex-1 overflow-y-auto px-3 pb-4 pt-2"
      >
        <NavList context={context} />
      </nav>

      <div className="sidebar-footer m-3 mt-0 shrink-0 rounded-card bg-gradient-to-br from-identity-50 via-surface-brand to-brand-100/60 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-identity-700">
          {professional ? (
            <ShieldCheck className="size-4" aria-hidden="true" />
          ) : (
            <LockKeyhole className="size-4" aria-hidden="true" />
          )}
          {professional ? "Somente o que foi compartilhado" : "Seus dados são seus"}
        </p>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          {professional
            ? "O acesso respeita o escopo autorizado por cada pessoa."
            : "Elyra acompanha, não diagnostica. Você controla o que compartilha."}
        </p>
      </div>
    </aside>
  );
}
