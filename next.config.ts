import type { NextConfig } from "next";

import { serverActionsConfig } from "./src/lib/security/server-actions-origins";

/**
 * `experimental` do QA, quando houver.
 *
 * Extraido antes para poder ser **mesclado** em vez de espalhado por cima. Ver a
 * nota em `experimental`, abaixo.
 */
const qaExperimental = (serverActionsConfig().experimental ?? {}) as Record<
  string,
  unknown
>;

/**
 * Cabecalhos de seguranca NAO ficam aqui.
 *
 * A CSP precisa do host do Supabase do ambiente atual e de um nonce por
 * request, e `next.config.ts` so aceita lista estatica. Eles sao aplicados em
 * `src/lib/supabase/proxy.ts`, onde ha runtime. Ver `src/lib/security/headers.ts`.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,

  async headers() {
    return [
      {
        source: "/placeholder/:asset*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
    ];
  },


  env: {
    NEXT_PUBLIC_ELYRA_BUILD: process.env.ELYRA_BUILD_ID ?? `build-${Date.now()}`,
  },

  // No QA local, o adapter do Proxy tambem normaliza Location de 127.0.0.1
  // para localhost e o torna relativo. Preservar a URL original e necessario
  // para o redirect de origem acontecer antes da criacao do cookie PKCE.
  skipProxyUrlNormalize:
    process.env.ELYRA_RUNTIME_ENV === "qa" &&
    process.env.NEXT_PUBLIC_SUPABASE_URL === "http://127.0.0.1:54381",


  experimental: {
    proxyClientMaxBodySize: 34 * 1024 * 1024,

    ...qaExperimental,
  },


  /**
   * `@huggingface/transformers` arrasta `onnxruntime-node` e `sharp`, que sao
   * binarios nativos de servidor. O ASR da Elyra roda **no navegador**; deixar o
   * bundler tentar empacota-los quebraria o build por um caminho que nunca e
   * executado.
   */
  serverExternalPackages: ["@huggingface/transformers", "onnxruntime-node", "sharp"],

  poweredByHeader: false,


  typedRoutes: true,

};

export default nextConfig;
