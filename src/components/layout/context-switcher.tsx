import { BadgeCheck, UserRound } from "lucide-react";

import { switchContextAction } from "@/app/context-actions";
import type { NavContext } from "@/components/layout/nav-config";
import { cn } from "@/lib/utils";


export function ContextSwitcher({ context, className }: { context: NavContext; className?: string }) {
  const professional = context === "professional";
  const segment =
    "inline-flex min-h-9 flex-1 items-center justify-center gap-1.5 rounded-pill px-3 text-xs font-medium transition-colors";
  const items = [
    { value: "personal" as const, label: "Pessoal", icon: UserRound, current: !professional },
    { value: "professional" as const, label: "Profissional", icon: BadgeCheck, current: professional },
  ];

  return (
    // `role="group"` nao e permitido em <form> (axe aria-allowed-role): o grupo
    // envolve o formulario.
    <div role="group" aria-label="Área da conta (mesma conta, outra área)" data-testid="context-switcher" data-context={context}>
      <form
        action={switchContextAction}
        className={cn("context-switcher flex w-full items-center gap-1 rounded-pill border border-line bg-surface-muted p-1", className)}
      >
        {items.map(({ value, label, icon: Icon, current }) =>
          current ? (
            <span
              key={value}
              aria-current="true"
              title={label}
              className={cn(
                segment,
                value === "professional" ? "bg-identity-50 text-identity-700" : "bg-surface text-ink shadow-card",
              )}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="context-switcher-label">{label}</span>
            </span>
          ) : (
            <button
              key={value}
              type="submit"
              name="context"
              value={value}
              className={cn(segment, "motion-press text-ink-muted hover:bg-surface hover:text-ink")}
              aria-label={value === "professional" ? "Ir para a área profissional" : "Ir para a área pessoal"}
              title={value === "professional" ? "Ir para a área profissional" : "Ir para a área pessoal"}
            >
              <Icon className="size-3.5" aria-hidden="true" />
              <span className="context-switcher-label">{label}</span>
            </button>
          ),
        )}
      </form>
    </div>
  );
}
