import "server-only";

/**
 * Configuracao da verificacao profissional V2 (ADR-0028) — ZERO_COST_BASELINE.
 *
 * Regras que este arquivo garante:
 * 1. Nenhuma chave e obrigatoria para subir. Sem nada configurado, a Elyra
 *    funciona: a verificacao cai na fila humana.
 * 2. Provider PAGO so liga com as TRES coisas: flag explicita `=true`,
 *    credencial e orcamento diario > 0. A chave sozinha nunca liga nada.
 * 3. Orcamento pago padrao = 0 → zero chamadas pagas.
 * 4. Fixture de QA so em ambiente local: flag explicita E Supabase em
 *    127.0.0.1/localhost E (desenvolvimento OU `ELYRA_RUNTIME_ENV=qa`, o mesmo
 *    mecanismo de QA do rate limit, que producao nunca le). O banco ainda
 *    exige o interruptor `accept_fixture_evidence` (default off). Fixture
 *    nunca e verificacao real.
 */

export type VerificationEnvironment = Readonly<Record<string, string | undefined>>;

export interface PaidProviderConfig {
  enabled: boolean;
  /** Motivo quando desligado — so para log/diagnostico, nunca para o usuario. */
  reason: "enabled" | "flag_off" | "missing_credential" | "budget_zero";
}

export interface VerificationConfig {
  cfpOfficialEnabled: boolean;
  infosimples: PaidProviderConfig;
  datavalid: PaidProviderConfig;
  /** Chamadas pagas por dia (UTC), somando todos os providers pagos. */
  paidDailyLimit: number;
  fixturesEnabled: boolean;
  timeoutMs: number;
}

const flag = (value: string | undefined) => value?.trim().toLowerCase() === "true";

function paid(env: VerificationEnvironment, flagName: string, credentialNames: string[], limit: number): PaidProviderConfig {
  if (!flag(env[flagName])) return { enabled: false, reason: "flag_off" };
  if (credentialNames.some((name) => !env[name]?.trim())) return { enabled: false, reason: "missing_credential" };
  if (limit <= 0) return { enabled: false, reason: "budget_zero" };
  return { enabled: true, reason: "enabled" };
}

export function isLocalSupabase(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return ["127.0.0.1", "localhost"].includes(new URL(url).hostname);
  } catch {
    return false;
  }
}

export function readVerificationConfig(env: VerificationEnvironment = process.env): VerificationConfig {
  const rawLimit = Number.parseInt(env.PAID_VERIFICATION_DAILY_LIMIT ?? "0", 10);
  const paidDailyLimit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 10_000) : 0;
  return {
    // Fonte oficial gratuita: ligada por padrao (desligar e opcao, nao o contrario).
    cfpOfficialEnabled: env.ELYRA_CFP_OFFICIAL_ENABLED?.trim().toLowerCase() !== "false",
    infosimples: paid(env, "ELYRA_INFOSIMPLES_ENABLED", ["INFOSIMPLES_TOKEN"], paidDailyLimit),
    datavalid: paid(env, "ELYRA_DATAVALID_ENABLED", ["DATAVALID_CLIENT_ID", "DATAVALID_CLIENT_SECRET"], paidDailyLimit),
    paidDailyLimit,
    fixturesEnabled:
      env.ELYRA_VERIFICATION_FIXTURES?.trim() === "local" &&
      (env.NODE_ENV !== "production" || env.ELYRA_RUNTIME_ENV === "qa") &&
      isLocalSupabase(env.NEXT_PUBLIC_SUPABASE_URL),
    timeoutMs: 4_000,
  };
}
