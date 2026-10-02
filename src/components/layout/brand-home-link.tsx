import Link from "next/link";

import { BrandRing } from "@/components/brand/brand-ring";
import { Logo } from "@/components/layout/logo";
import { cn } from "@/lib/utils";

/**
 * Logo da Elyra como caminho para o Dashboard — em todo contexto.
 *
 * Um componente so, para o contrato nao depender de cada tela: online o Next
 * navega sem recarregar; sem conexao confirmada, o runtime de conectividade
 * (`useOfflineNavigation`) desvia o mesmo clique para o Dashboard local. O destino
 * e `/dashboard`, e nao `/`: a raiz so redireciona no servidor, e sem rede ela
 * cairia numa area "precisa de conexao".
 */
export function BrandHomeLink({
  variant = "full",
  priority = false,
  className,
  logoClassName,
  ringClassName,
}: {
  variant?: "full" | "symbol";
  priority?: boolean;
  className?: string;
  logoClassName?: string;
  ringClassName?: string;
}) {
  return (
    <Link
      href="/dashboard"
      aria-label="Ir para o Dashboard"
      className={cn(
        "brand-hover flex items-center rounded-control",
        variant === "symbol" && "min-h-11 min-w-11 shrink-0 justify-center rounded-pill px-1",
        className,
      )}
    >
      <Logo variant={variant} priority={priority} className={logoClassName} />
      <BrandRing className={ringClassName} />
    </Link>
  );
}
