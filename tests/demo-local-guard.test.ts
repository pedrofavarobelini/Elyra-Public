// @vitest-environment node
import { describe, expect, it } from "vitest";

import { demoTargetRefusal } from "../scripts/lib/demo-local-guard.mjs";

function jwt(iss: string) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part({ iss, role: "service_role" })}.c2ln`;
}

const LOCAL = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54381",
  SUPABASE_SERVICE_ROLE_KEY: jwt("supabase-demo"),
  ELYRA_RUNTIME_ENV: "qa",
};

describe("demoTargetRefusal (demo profissional so no Supabase local)", () => {
  it("aceita o Supabase local do CLI", () => {
    expect(demoTargetRefusal(LOCAL)).toBeNull();
    expect(demoTargetRefusal({ ...LOCAL, NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54381" })).toBeNull();
  });

  it.each([
    ["hosted", { NEXT_PUBLIC_SUPABASE_URL: "https://abcd.example.invalid" }, "url_publica_nao_http_local"],
    ["dominio externo", { NEXT_PUBLIC_SUPABASE_URL: "http://elyra.example:54381" }, "url_publica_host_nao_local"],
    ["porta de outro servico", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:8000" }, "url_publica_porta_nao_local"],
    ["endpoint administrativo hosted", { SUPABASE_URL: "https://abcd.example.invalid" }, "url_administrativa_nao_http_local"],
    ["chave de projeto hosted", { SUPABASE_SERVICE_ROLE_KEY: jwt("supabase") }, "chave_administrativa_nao_local"],
    ["chave em outro formato", { SUPABASE_SERVICE_ROLE_KEY: "sb_secret_hosted" }, "chave_administrativa_nao_local"],
    ["runtime producao", { ELYRA_RUNTIME_ENV: "production" }, "runtime_production"],
    ["runtime staging", { ELYRA_RUNTIME_ENV: "staging" }, "runtime_staging"],
    ["runtime preview", { ELYRA_RUNTIME_ENV: "preview" }, "runtime_preview"],
    ["NODE_ENV producao", { NODE_ENV: "production" }, "node_env_production"],
    ["Vercel", { VERCEL_ENV: "preview" }, "vercel"],
    ["url com credencial", { NEXT_PUBLIC_SUPABASE_URL: "http://user:pw@127.0.0.1:54381" }, "url_publica_com_credencial"],
  ])("recusa %s", (_case, override, reason) => {
    expect(demoTargetRefusal({ ...LOCAL, ...override })).toBe(reason);
  });

  it("recusa ambiente sem configuracao", () => {
    expect(demoTargetRefusal({})).toBe("url_publica_ausente");
    expect(demoTargetRefusal({ NEXT_PUBLIC_SUPABASE_URL: LOCAL.NEXT_PUBLIC_SUPABASE_URL })).toBe("chave_administrativa_ausente");
  });
});
