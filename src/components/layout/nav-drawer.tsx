"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { ChevronRight, LockKeyhole, Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

import { BrandHomeLink } from "@/components/layout/brand-home-link";
import type { NavContext } from "@/components/layout/nav-config";
import { ContextSwitcher } from "@/components/layout/context-switcher";
import { NavList } from "@/components/layout/nav-list";
import { cn } from "@/lib/utils";


export function NavDrawer({
  context = "user",
  userInitials = "P",
  showContextSwitcher = false,
}: {
  context?: NavContext;
  userInitials?: string;
  showContextSwitcher?: boolean;
}) {
  const pathname = usePathname();

  /*
   * Fechar ao navegar, sem sincronizar estado num efeito.
   *
   * O estado guardado nao e "aberto?", e **em qual rota** o drawer foi aberto.
   * "Aberto" e derivado: so esta aberto se a rota atual e a mesma de quando
   * abriu. A troca de rota fecha o drawer por consequencia — inclusive quando a
   * navegacao nao parte daqui (voltar do navegador, redirect do servidor).
   */
  const [openedAt, setOpenedAt] = useState<string | null>(null);
  const open = openedAt !== null && openedAt === pathname;

  const setOpen = (next: boolean) => setOpenedAt(next ? pathname : null);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger
        className="motion-press inline-flex size-11 shrink-0 items-center justify-center rounded-control text-ink-muted transition-colors hover:bg-surface hover:text-ink lg:hidden"
        aria-label="Abrir menu de navegação"
      >
        <Menu className="size-5" aria-hidden="true" />
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          data-elyra-backdrop=""
          className="fixed inset-0 z-50 bg-ink/30 backdrop-blur-[2px]"
        />
        <DialogPrimitive.Content
          data-elyra-drawer=""
          aria-label="Menu"
          className={cn(
            "fixed inset-y-0 left-0 z-50 flex w-[min(20rem,86vw)] flex-col",
            "rounded-r-panel border-r border-line bg-surface shadow-overlay",
            "pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)]",
          )}
        >
          <div className="flex h-16 shrink-0 items-center justify-between px-4">
            <DialogPrimitive.Title className="sr-only">
              Navegação principal
            </DialogPrimitive.Title>
            <BrandHomeLink ringClassName="!right-auto aspect-square !h-[calc(100%+12px)] !w-auto" />
            <DialogPrimitive.Close
              className="motion-press inline-flex size-11 items-center justify-center rounded-control text-ink-subtle transition-colors hover:bg-surface-muted hover:text-ink"
              aria-label="Fechar menu"
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          {/* O nome acessivel vive no `nav`, e nao no dialog: quem navega por
              landmarks procura a navegacao, nao o container que a carrega. */}
          <nav
            aria-label="Navegação principal"
            className="flex-1 overflow-y-auto px-3 py-2"
          >
            {/*
              Fechar tambem no clique: tocar no destino em que ja se esta e um
              gesto comum, e nesse caso o `pathname` nao muda.
            */}
            <NavList
              context={context}
              onNavigate={() => setOpenedAt(null)}
              stagger
            />
          </nav>

          {/*
            Rodape com funcao: a conta a um toque e as duas promessas da Elyra.
            Sem ele, a metade inferior do drawer ficava vazia no celular.
          */}
          <div className="shrink-0 space-y-3 border-t border-line p-3">
            {showContextSwitcher ? <ContextSwitcher context={context} /> : null}
            <Link
              href={context === "user" ? "/perfil" : "/pro/perfil"}
              onClick={() => setOpenedAt(null)}
              className="motion-press flex min-h-14 items-center gap-3 rounded-card border border-line bg-surface px-3 py-2 transition-colors hover:border-brand-200 hover:bg-surface-brand"
            >
              <span
                aria-hidden="true"
                className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-xs font-semibold text-brand-700"
              >
                {userInitials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">Minha conta</span>
                <span className="block text-xs text-ink-muted">Perfil, acesso e sessão</span>
              </span>
              <ChevronRight className="size-4 text-ink-subtle" aria-hidden="true" />
            </Link>
            <p className="flex items-start gap-2 rounded-control bg-gradient-to-br from-identity-50 to-surface-brand px-3 py-2.5 text-xs leading-5 text-ink-muted">
              <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-identity-600" aria-hidden="true" />
              <span>
                <span className="font-semibold text-identity-700">Seus dados são seus.</span>{" "}
                Elyra acompanha, não diagnostica.
              </span>
            </p>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
