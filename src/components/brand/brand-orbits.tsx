import { cn } from "@/lib/utils";


export function BrandOrbits({
  className,
  variant = "loader",
}: {
  className?: string;
  /** `splash`: tres planos convergindo. `loader`: dois aneis em giro continuo. */
  variant?: "splash" | "loader";
}) {
  if (variant === "loader") {
    return (
      <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0", className)}>
        <svg viewBox="0 0 100 100" className="brand-orbit-outer absolute inset-0 size-full">
          <defs>
            <linearGradient id="elyra-orbit-a" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="var(--color-identity-500)" />
              <stop offset="100%" stopColor="var(--color-brand-400)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="url(#elyra-orbit-a)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="190 100"
          />
        </svg>
        <svg viewBox="0 0 100 100" className="brand-orbit-inner absolute inset-[14%] size-[72%]">
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="var(--color-brand-500)"
            strokeOpacity="0.7"
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray="70 210"
          />
        </svg>
      </span>
    );
  }

  return (
    <span aria-hidden="true" className={cn("pointer-events-none absolute inset-0 [perspective:640px]", className)}>
      {[
        { cls: "brand-splash-plane-a", stroke: "var(--color-identity-500)", dash: "150 140" },
        { cls: "brand-splash-plane-b", stroke: "var(--color-brand-500)", dash: "120 170" },
      ].map((plane) => (
        <svg key={plane.cls} viewBox="0 0 100 100" className={cn("absolute inset-0 size-full", plane.cls)}>
          <ellipse
            cx="50"
            cy="50"
            rx="46"
            ry="30"
            fill="none"
            stroke={plane.stroke}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeDasharray={plane.dash}
          />
        </svg>
      ))}
      <span className="brand-splash-halo absolute inset-[22%] rounded-pill bg-[radial-gradient(circle,var(--color-brand-100)_0%,transparent_70%)]" />
    </span>
  );
}
