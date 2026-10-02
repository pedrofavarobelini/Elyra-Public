import Image from "next/image";

import { BrandOrbits } from "@/components/brand/brand-orbits";
import { cn } from "@/lib/utils";

/**
 * Loader de marca: simbolo oficial com duas orbitas em velocidades diferentes.
 * Substitui o spinner generico. O texto do estado continua sendo de quem usa
 * (`LoadingState`), com `role="status"` — a animacao nunca carrega a informacao.
 */
export function BrandLoader({
  className,
  size = "md",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        size === "sm" ? "size-8" : "size-14",
        className,
      )}
    >
      <BrandOrbits variant="loader" />
      <Image
        src="/placeholder/symbol.svg"
        width={345}
        height={366}
        alt=""
        sizes="32px"
        className={cn("relative w-auto", size === "sm" ? "h-3.5" : "h-6")}
      />
    </span>
  );
}
