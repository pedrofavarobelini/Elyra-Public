
export interface AccountFacts {
  createdAt: string | null;
  lastSignInAt: string | null;
  /** Provedor do Supabase Auth ("email", "google"); `null` quando ausente. */
  provider: string | null;
}

export function accountFactsFrom(user: {
  created_at?: string | null;
  last_sign_in_at?: string | null;
  app_metadata?: Record<string, unknown> | null;
}): AccountFacts {
  const provider = user.app_metadata?.provider;
  return {
    createdAt: user.created_at ?? null,
    lastSignInAt: user.last_sign_in_at ?? null,
    provider: typeof provider === "string" ? provider : null,
  };
}

const PROVIDER_LABEL: Record<string, string> = {
  email: "E-mail e senha",
  google: "Conta Google",
};

export function providerLabel(provider: string | null): string | null {
  if (!provider) return null;
  return PROVIDER_LABEL[provider] ?? provider;
}

/** Sem provedor declarado, o caminho historico da Elyra e e-mail e senha. */
export function usesPassword(provider: string | null): boolean {
  return provider === null || provider === "email";
}

export function formatMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

export function formatDateTime(iso: string | null): string | null {
  if (!iso) return null;
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}
