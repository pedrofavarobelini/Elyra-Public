import { Compass } from "lucide-react";
import Link from "next/link";

import { Logo } from "@/components/layout/logo";


export default function RootNotFound() {
  return (
    <main className="elyra-canvas flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="flex w-full max-w-md flex-col items-center gap-4 rounded-panel border border-line bg-surface p-6 text-center shadow-raised sm:p-8">
        <Logo className="h-9" />
        <span
          aria-hidden="true"
          className="mt-2 inline-flex size-12 items-center justify-center rounded-pill bg-brand-100 text-brand-600"
        >
          <Compass className="size-6" />
        </span>
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Não encontramos esta página
        </h1>
        <p className="text-sm text-ink-muted">
          O endereço pode estar incorreto ou ter mudado.
        </p>
        <div className="mt-2 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
          <Link
            href="/"
            className="inline-flex h-11 items-center justify-center rounded-control bg-brand-600 px-4 text-sm font-medium text-white transition-colors hover:bg-brand-700"
          >
            Ir para o início
          </Link>
          <Link
            href="/entrar"
            className="inline-flex h-11 items-center justify-center rounded-control border border-line-strong bg-surface px-4 text-sm font-medium text-ink transition-colors hover:bg-surface-brand"
          >
            Entrar
          </Link>
        </div>
      </div>
    </main>
  );
}
