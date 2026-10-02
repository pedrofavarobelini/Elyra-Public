import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

import { HelpContacts } from "@/components/help/help-contacts";
import { Logo } from "@/components/layout/logo";
import { OfflineShell } from "@/components/offline/offline-shell";
import { SOS_NO_AUTOMATIC_DISPATCH } from "@/lib/contracts/help";

export const metadata: Metadata = {
  title: "Sem conexão",
  robots: { index: false, follow: false },
};


export const dynamic = "force-dynamic";

export default function OfflinePage() {
  return (
    <OfflineShell
      fallback={
    <main className="elyra-canvas flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col gap-4 rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
      <Logo className="h-9" />
      <span
        aria-hidden="true"
        className="mt-2 inline-flex size-12 items-center justify-center rounded-pill bg-attention-soft text-attention"
      >
        <WifiOff className="size-6" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight text-ink">
        Sem conexão
      </h1>
      <p className="text-sm text-ink-muted">
        Não foi possível carregar esta tela porque o aparelho está sem rede. O
        que você já tinha escrito e não enviou continua na tela anterior.
      </p>
      <p className="text-sm text-ink-muted">
        Diário, Meu Humor, Metas e Ciclo funcionam sem internet neste aparelho
        depois que você abrir a Elyra com conexão (vale por 14 dias). O que você
        registrar sem rede fica guardado aqui e sincroniza quando ela voltar.
      </p>
      <p className="text-xs text-ink-subtle">
        Assim que a rede voltar, use o botão voltar do navegador ou abra a Elyra
        novamente.
      </p>
      {/*
        Ajuda imediata tambem sem internet: ligacao usa a rede de telefonia, e a
        lista e texto fixo servido do cache (Stage 24, R2).
      */}
      <section aria-labelledby="offline-ajuda" className="mt-2 border-t border-line pt-4">
        <h2 id="offline-ajuda" className="text-base font-semibold text-ink">
          Precisa de ajuda agora?
        </h2>
        <p className="mb-3 text-xs text-ink-muted">{SOS_NO_AUTOMATIC_DISPATCH}</p>
        <HelpContacts />
      </section>
      </div>
    </main>
      }
    />
  );
}
