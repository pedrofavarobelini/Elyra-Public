import { AlertCircle, Inbox, LoaderCircle } from "lucide-react";
import type * as React from "react";

import { BrandLoader } from "@/components/brand/brand-loader";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/*
 * Sistema de loading (MOTION-1, MOTION-GAP-02). Um componente por situacao:
 *
 * - `LoadingState`: bloco ou colecao inteira esperando dado (marca + texto);
 * - `InlineLoading`: uma parte da tela (lista, busca, painel), com texto;
 * - `InlineSpinner`: dentro de botao ou linha, enquanto UMA acao roda. O texto
 *   da acao ("Salvando...") continua de quem usa.
 *
 * `loading.tsx` por rota foi medido e rejeitado (MOTION-1): o dado do shell vem
 * do layout, e o limite de Suspense deixava `data-hydrated` chegar antes do
 * conteudo transmitido (texto duplicado no DOM durante o streaming).
 *
 * Todos respeitam movimento reduzido pelo CSS global (sistema e preferencia
 * interna): a animacao para, a informacao continua no texto.
 */

/** Spinner de acao em andamento: sempre decorativo (`aria-hidden`). */
export function InlineSpinner({ size = "md", className }: { size?: "sm" | "md" | "lg"; className?: string }) {
  return (
    <LoaderCircle
      aria-hidden="true"
      data-elyra-spinner=""
      className={cn(
        "shrink-0 animate-spin",
        size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4",
        className,
      )}
    />
  );
}

/**
 * Carregamento de uma parte da tela (lista de horarios, busca, painel): texto
 * obrigatorio, spinner decorativo. Pagina ou colecao inteira usa `LoadingState`.
 */
export function InlineLoading({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p role="status" data-elyra-loading="inline" className={cn("flex items-center gap-2 text-sm text-ink-muted", className)}>
      <InlineSpinner />
      {children}
    </p>
  );
}

/**
 * Vazio numa linha, para lista densa (workspace profissional, historicos,
 * cartoes de configuracao). Pagina ou colecao vazia usa `EmptyState`.
 */
export function InlineEmpty({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p data-elyra-empty="inline" className={cn("text-sm text-ink-muted", className)}>
      {children}
    </p>
  );
}

/** Estado: loading. */
export function LoadingState({
  label = "Carregando...",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-3 p-10 text-ink-muted",
        className,
      )}
    >
      <BrandLoader />
      <p className="text-sm">{label}</p>
    </div>
  );
}


export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
  size = "default",
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  icon?: React.ReactNode;
  className?: string;
  size?: "default" | "compact";
}) {
  if (size === "compact") {
    return (
      <div
        className={cn(
          "flex flex-col items-start gap-3 rounded-control bg-surface-muted/70 px-4 py-4 sm:flex-row sm:items-center",
          className,
        )}
      >
        <span
          className="inline-flex size-10 shrink-0 items-center justify-center rounded-pill bg-brand-100 text-brand-600 [&_svg]:size-5"
          aria-hidden="true"
        >
          {icon ?? <Inbox />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{title}</p>
          {description ? (
            <p className="mt-0.5 text-sm text-ink-muted">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-1.5 px-6 py-10 text-center",
        className,
      )}
    >
      <span
        className="mb-2 inline-flex size-12 items-center justify-center rounded-pill bg-brand-100 text-brand-600 [&_svg]:size-6"
        aria-hidden="true"
      >
        {icon ?? <Inbox />}
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/** Estado: error. Nunca expoe detalhe tecnico ou conteudo sensivel. */
export function ErrorState({
  title = "Não foi possível carregar",
  description = "Tente novamente em alguns instantes.",
  onRetry,
  className,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-2 p-10 text-center",
        className,
      )}
    >
      <span
        className="mb-2 inline-flex size-12 items-center justify-center rounded-pill bg-attention-soft text-attention"
        aria-hidden="true"
      >
        <AlertCircle className="size-6" />
      </span>
      <p className="text-base font-semibold text-ink">{title}</p>
      <p className="max-w-sm text-sm text-ink-muted">{description}</p>
      {onRetry ? (
        <Button variant="secondary" size="sm" className="mt-3" onClick={onRetry}>
          Tentar novamente
        </Button>
      ) : null}
    </div>
  );
}

/** Estado: success (confirmacao inline). */
export function SuccessState({
  title,
  description,
  className,
}: {
  title: string;
  description?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-col items-center justify-center gap-1 rounded-control bg-positive-soft p-6 text-center",
        className,
      )}
    >
      <p className="motion-pop text-sm font-medium text-positive">{title}</p>
      {description ? (
        <p className="text-sm text-ink-muted">{description}</p>
      ) : null}
    </div>
  );
}
