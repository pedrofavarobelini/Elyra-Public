

export const LOCAL_HOSTS = ["127.0.0.1", "localhost"];
export const LOCAL_API_PORT = "54381";

function localEndpoint(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return `${name}_invalido`;
  }
  if (url.protocol !== "http:") return `${name}_nao_http_local`;
  if (!LOCAL_HOSTS.includes(url.hostname)) return `${name}_host_nao_local`;
  if (url.port !== LOCAL_API_PORT) return `${name}_porta_nao_local`;
  if (url.username || url.password) return `${name}_com_credencial`;
  return null;
}

function jwtIssuer(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.iss === "string" ? payload.iss : null;
  } catch {
    return null;
  }
}

/** `null` quando o alvo e local; senao o motivo da recusa. */
export function demoTargetRefusal(env) {
  const publicUrl = env.NEXT_PUBLIC_SUPABASE_URL;
  if (!publicUrl) return "url_publica_ausente";
  const publicProblem = localEndpoint(publicUrl, "url_publica");
  if (publicProblem) return publicProblem;
  if (env.SUPABASE_URL) {
    const adminProblem = localEndpoint(env.SUPABASE_URL, "url_administrativa");
    if (adminProblem) return adminProblem;
  }
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return "chave_administrativa_ausente";
  if (jwtIssuer(key) !== "supabase-demo") return "chave_administrativa_nao_local";
  const runtime = String(env.ELYRA_RUNTIME_ENV ?? "").toLowerCase();
  if (["production", "prod", "staging", "preview"].includes(runtime)) return `runtime_${runtime}`;
  if (env.NODE_ENV === "production") return "node_env_production";
  if (env.VERCEL || env.VERCEL_ENV) return "vercel";
  return null;
}
