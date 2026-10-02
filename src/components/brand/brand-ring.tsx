/**
 * Anel da micro-resposta de marca. Fica dentro de um elemento com a classe
 * `brand-hover`; o CSS o traca uma vez em hover, toque ou foco. Decorativo.
 */
import { cn } from "@/lib/utils";

export function BrandRing({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 100 100" className={cn("brand-ring", className)}>
      <circle
        cx="50"
        cy="50"
        r="47"
        fill="none"
        pathLength={1}
        stroke="var(--color-brand-400)"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  );
}
