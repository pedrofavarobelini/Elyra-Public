import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/** Junta classes condicionais resolvendo conflitos do Tailwind. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formata um score 0-10 no padrao visual da Elyra (virgula decimal).
 * Retorna null quando o valor e ausente - NULL nao e zero.
 */
export function formatScore(value: number | null | undefined): string | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/** Formata duracao em minutos como "7h 12m". Ausencia retorna null. */
export function formatDuration(minutes: number | null | undefined): string | null {
  if (minutes === null || minutes === undefined || Number.isNaN(minutes)) return null;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}
