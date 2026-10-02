import "server-only";

/**
 * Configuracao do provider de midia (ADR-0025). Tudo server-only: nenhuma
 * destas variaveis pode ter prefixo `NEXT_PUBLIC_` (teste em
 * `realtime.test.ts`). O navegador recebe so a URL publica do servidor de
 * midia, um token curto e a chave E2EE da geracao, na resposta `no-store`.
 *
 * Configuracao ausente ou fraca = provider indisponivel: a rota responde
 * "Nao foi possivel iniciar a chamada." em vez de tentar sem segredo.
 */
export const MIN_REALTIME_SECRET_LENGTH = 32;

export type RealtimeConfig = Readonly<{
  url: string;
  apiKey: string;
  apiSecret: string;
  roomSalt: string;
  e2eeSecret: string;
}>;

export type RealtimeEnvironment = Readonly<Record<string, string | undefined>>;

function strong(value: string | undefined): value is string {
  return (value?.trim().length ?? 0) >= MIN_REALTIME_SECRET_LENGTH;
}

export function readRealtimeConfig(env: RealtimeEnvironment = process.env): RealtimeConfig | null {
  const url = env.LIVEKIT_URL?.trim() ?? "";
  const apiKey = env.LIVEKIT_API_KEY?.trim() ?? "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") return null;
  // Fora do ambiente local, midia so por TLS.
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "ws:" && !local) return null;
  if (!apiKey || !strong(env.LIVEKIT_API_SECRET) || !strong(env.REALTIME_ROOM_SALT) || !strong(env.REALTIME_E2EE_SECRET)) {
    return null;
  }
  return {
    url: parsed.origin.replace(/^http/, "ws"),
    apiKey,
    apiSecret: env.LIVEKIT_API_SECRET!.trim(),
    roomSalt: env.REALTIME_ROOM_SALT!.trim(),
    e2eeSecret: env.REALTIME_E2EE_SECRET!.trim(),
  };
}

/** Origem publica do servidor de midia, para a CSP. Nunca devolve segredo. */
export function realtimePublicOrigin(env: RealtimeEnvironment = process.env): string | null {
  const url = env.LIVEKIT_URL?.trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "wss:" || parsed.protocol === "ws:" ? parsed.origin : null;
  } catch {
    return null;
  }
}
