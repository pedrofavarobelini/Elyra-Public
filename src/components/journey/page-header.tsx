import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Cabecalho de pagina do Design System V2.
 *
 * Um unico `h1` por pagina. `eyebrow` e contexto curto acima do titulo (ex.:
 * "Beta", "Privado"); `meta` fica ao lado da descricao para selos de estado.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
  meta,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-4 lg:mb-6",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow ? <div className="mb-2">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-ink lg:text-[1.75rem] lg:leading-9">
          {title}
        </h1>
        {description || meta ? (
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-2">
            {description ? (
              <p className="text-[0.9375rem] leading-6 text-ink-muted">
                {description}
              </p>
            ) : null}
            {meta}
          </div>
        ) : null}
      </div>
      {/*
        `max-w-full` nao e enfeite: sem ele, `shrink-0` faz o bloco de acoes
        assumir a largura do proprio conteudo e ignorar o viewport. Um `flex-wrap`
        la dentro nunca chega a quebrar linha, porque recebe largura de sobra - e
        foi exatamente assim que tres botoes de download esticaram `/relatorios`
        para 532px num viewport de 393px, deixando a pagina rolando na horizontal
        e clique caindo em cima do elemento errado.
      */}
      {action ? <div className="max-w-full shrink-0">{action}</div> : null}
    </header>
  );
}

/** Cabecalho de secao dentro de uma pagina (h2). */
export function SectionHeader({
  title,
  description,
  action,
  className,
  as: Heading = "h2",
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
  as?: "h2" | "h3";
}) {
  return (
    <div
      className={cn(
        "mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2",
        className,
      )}
    >
      <div className="min-w-0">
        <Heading className="text-base font-semibold text-ink lg:text-lg">
          {title}
        </Heading>
        {description ? (
          <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
        ) : null}
      </div>
      {action ? <div className="max-w-full shrink-0">{action}</div> : null}
    </div>
  );
}
