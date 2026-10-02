/**
 * WebAuthn exige um RP ID de dominio e aceita `localhost` como origem segura
 * no desenvolvimento. Canonicalizar o IP antes de criar cookies/PKCE impede
 * que a sessao nasca em 127.0.0.1 e depois seja invisivel para a Passkey.
 * Host vem do header real: NextRequest.url normaliza o IP para localhost.
 */
export function canonicalLocalQaOrigin(
  headers: Pick<Headers, "get">,
  protocol: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | null {
  if (
    environment.ELYRA_RUNTIME_ENV !== "qa" ||
    environment.NEXT_PUBLIC_SUPABASE_URL !== "http://127.0.0.1:54381" ||
    protocol !== "http:" ||
    (headers.get("x-forwarded-proto") ?? "http").split(",")[0]?.trim() !== "http"
  ) return null;

  const match = /^127\.0\.0\.1:(3000|3100)$/i.exec(headers.get("host") ?? "");
  return match ? `http://localhost:${match[1]}` : null;
}
