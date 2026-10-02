import { HeartHandshake, LockKeyhole, ShieldCheck } from "lucide-react";
import type * as React from "react";

import { DesktopBrandMotion } from "@/components/brand/brand-experience";


export function AuthFrame({ children }: { children: React.ReactNode }) {
  return (
    <main className="elyra-canvas min-h-dvh lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <aside className="relative hidden min-h-dvh overflow-hidden border-r border-line bg-gradient-to-br from-identity-50 via-surface-brand to-brand-100 lg:grid lg:grid-rows-[minmax(16rem,1fr)_auto_auto] lg:gap-8 lg:p-12 xl:p-16">
        <DesktopBrandMotion />

        <div className="max-w-md">
          <p className="text-3xl font-semibold leading-tight tracking-tight text-ink xl:text-4xl">
            Um espaço seu para acompanhar como você está.
          </p>
          <p className="mt-4 text-base leading-7 text-ink-muted">
            Registros, diário e evolução no seu ritmo — com você decidindo o que
            fica guardado e o que é compartilhado.
          </p>

          <ul className="mt-8 grid gap-4">
            {[
              {
                icon: LockKeyhole,
                title: "Privado por padrão",
                text: "Seu diário e suas sessões são só seus até você decidir o contrário.",
              },
              {
                icon: HeartHandshake,
                title: "Apoio, não diagnóstico",
                text: "A Elyra ajuda a observar padrões. Ela não diagnostica nem prescreve.",
              },
              {
                icon: ShieldCheck,
                title: "Você controla o compartilhamento",
                text: "Cada tipo de dado é uma decisão separada, que pode ser revogada.",
              },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-surface/80 text-identity-600 shadow-card"
                >
                  <Icon className="size-5" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-ink">{title}</span>
                  <span className="mt-0.5 block text-sm text-ink-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-xs text-ink-subtle">
          Elyra · acompanhamento não diagnóstico
        </p>

        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 600 200"
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 w-full text-brand-300"
        >
          <path d="M0 140 C 150 90, 300 170, 450 120 S 600 100, 600 100 L 600 200 L 0 200 Z" fill="currentColor" opacity="0.18" />
          <path d="M0 170 C 160 130, 320 200, 470 150 S 600 140, 600 140 L 600 200 L 0 200 Z" fill="currentColor" opacity="0.22" />
        </svg>
      </aside>

      <div className="flex min-h-dvh items-center justify-center px-4 py-10 sm:px-6 lg:min-h-0">
        {children}
      </div>
    </main>
  );
}

/** Titulo principal das telas de entrada: um `h1` por pagina. */
export function AuthTitle({ children }: { children: React.ReactNode }) {
  return (
    <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">
      {children}
    </h1>
  );
}
