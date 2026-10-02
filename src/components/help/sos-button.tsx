"use client";

import { ChevronRight, House, LifeBuoy, ShieldAlert } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { useSosPlacement } from "@/components/help/use-sos-placement";
import { cn } from "@/lib/utils";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { HelpContacts } from "@/components/help/help-contacts";
import { SOS_NO_AUTOMATIC_DISPATCH } from "@/lib/contracts/help";

/**
 * Onde o botao NAO aparece: preparo/captura de sessao multimodal, onde ele
 * cobriria os controles da sessao. Nas demais telas autenticadas ele fica fixo.
 */
const HIDDEN_ON = ["/sessoes/nova"];


export function SosButton() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const typing = useEditingOnMobile();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const excluded = HIDDEN_ON.some((path) => pathname?.startsWith(path));
  const placement = useSosPlacement(buttonRef, open || excluded);
  if (excluded) return null;

  const concealed = !open && (typing || placement.blocked);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          type="button"
          /* Nome contem o texto visivel ("SOS"), como pede WCAG 2.5.3. */
          aria-label="SOS: ajuda imediata"
          ref={buttonRef}
          data-elyra-sos=""
          data-sos-side={placement.side}
          data-sos-lift={placement.lift || undefined}
          data-sos-overlap={placement.overlap === "none" ? undefined : placement.overlap}
          data-sos-concealed={concealed || undefined}
          aria-hidden={concealed || undefined}
          tabIndex={concealed ? -1 : undefined}
          style={{
            ...(placement.side === "left" ? { left: placement.leftOffset, right: "auto" } : null),
            // Degrau vertical: margem inferior desloca um `fixed` sem mexer no fluxo.
            ...(placement.lift ? { marginBottom: placement.lift } : null),
          }}
          className={cn(
            "motion-press fixed bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.5rem))] right-[max(0.75rem,env(safe-area-inset-right))] z-30 inline-flex h-12 min-w-12 items-center justify-center gap-1 rounded-pill bg-sos px-3.5 text-xs font-bold tracking-wide text-white shadow-overlay ring-2 ring-sos-soft hover:bg-sos-strong focus-visible:outline-offset-4 lg:bottom-6 lg:right-6 lg:h-14 lg:min-w-14 lg:gap-1.5 lg:px-4 lg:text-sm lg:ring-4",
            "transition-[opacity,visibility,background-color] duration-[var(--duration-fast)] ease-[var(--ease-standard)]",
            concealed && "pointer-events-none invisible opacity-0",
          )}
        >
          <LifeBuoy className="size-4 lg:size-5" aria-hidden="true" />
          SOS
        </button>
      </DialogTrigger>
      <SosPanel />
    </Dialog>
  );
}

/**
 * Com o teclado virtual aberto, um botao fixo sobe junto e cobre o campo em
 * edicao. Abaixo de `lg`, enquanto um campo de texto tem foco, o botao sai de
 * cena e volta quando o foco sai.
 */
function useEditingOnMobile(): boolean {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const desktop =
      typeof window.matchMedia === "function"
        ? window.matchMedia("(min-width: 64rem)")
        : null;
    const isEditable = (node: EventTarget | null) =>
      node instanceof HTMLElement &&
      (node.isContentEditable ||
        node instanceof HTMLTextAreaElement ||
        node instanceof HTMLSelectElement ||
        (node instanceof HTMLInputElement &&
          !["button", "checkbox", "radio", "range", "submit", "reset", "file", "color"].includes(node.type)));

    /*
      Reaparecer com atraso: o toque que tira o foco do campo (ex.: "Adicionar"
      ao lado do input) dispara `focusout` antes do fim do gesto. Sem o atraso,
      o botao voltava embaixo do dedo e recebia o toque destinado a outro
      controle (achado do E2E mobile, R2).
    */
    let timer: number | undefined;
    const onFocusIn = (event: FocusEvent) => {
      window.clearTimeout(timer);
      if (!desktop?.matches && isEditable(event.target)) {
        setEditing(true);
        return;
      }
      // Foco que vai para um botao no meio do toque tambem espera: esconder e
      // imediato, reaparecer nunca e.
      timer = window.setTimeout(() => setEditing(false), 600);
    };
    const onFocusOut = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => setEditing(false), 600);
    };

    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("focusout", onFocusOut);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("focusout", onFocusOut);
    };
  }, []);

  return editing;
}

export function SosPanel() {
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <DialogContent
      className="sm:max-w-lg"
      /*
        Foco inicial no titulo, e nao no primeiro contato: com o foco em
        "Ligar 192", um Enter apressado abriria o discador.
      */
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        titleRef.current?.focus();
      }}
    >
      <DialogHeader>
        <DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">
          Precisa de ajuda agora?
        </DialogTitle>
        <DialogDescription>
          Escolha abaixo como falar com alguém. Cada opção só acontece quando
          você toca nela.
        </DialogDescription>
      </DialogHeader>

      <p className="mb-4 flex items-start gap-2 rounded-control border border-sos/25 bg-sos-soft px-3 py-2.5 text-sm font-medium text-sos-strong">
        <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span>
          {SOS_NO_AUTOMATIC_DISPATCH} Ninguém é avisado e sua localização não é
          enviada.
        </span>
      </p>

      <HelpContacts />

      {/*
        Rede de Apoio (SUP-2, ADR-0032; entrada unica decidida pelo owner em
        27/09): secao SEPARADA dos contatos imediatos — unidades de saude nao
        sao servico de emergencia. So um LINK: nada de busca, mapa, localizacao
        ou rede aqui; o painel continua estatico e sem prefetch. Fechar o painel
        e navegar sao o mesmo toque. Abrir a Rede nao pede localizacao.
      */}
      <section aria-labelledby="sos-support-network" className="mt-5 border-t border-line pt-4">
        <h3 id="sos-support-network" className="text-sm font-semibold text-ink">
          Rede de Apoio
        </h3>
        <p className="text-xs text-ink-muted">
          Não é emergência. Unidades de saúde e serviços de apoio, como UBS e
          CAPS, para buscar cuidado.
        </p>
        <DialogClose asChild>
          <Link
            href="/rede-de-apoio"
            prefetch={false}
            data-sos-support-network=""
            className="motion-press mt-2 flex min-h-14 items-center gap-3 rounded-control border border-line bg-surface px-3 py-2 transition-colors hover:bg-surface-muted"
          >
            <span aria-hidden="true" className="inline-flex size-9 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-brand-700">
              <House className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink">Abrir Rede de Apoio</span>
              <span className="block text-xs text-ink-muted">Encontrar unidades e serviços de saúde</span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-ink-subtle" aria-hidden="true" />
          </Link>
        </DialogClose>
      </section>

      <div className="mt-4 flex flex-col gap-1 text-xs text-ink-subtle">
        <p>
          Pessoa de confiança: ligue ou mande mensagem para alguém próximo. A
          Elyra não guarda contatos de emergência.
        </p>
        <p>Fora do Brasil, procure o número de emergência local.</p>
        <p>A Elyra não substitui atendimento profissional.</p>
      </div>
    </DialogContent>
  );
}
