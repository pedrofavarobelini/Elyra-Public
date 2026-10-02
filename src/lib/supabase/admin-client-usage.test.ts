import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guarda do cliente `service_role` (ADR-0022/ADR-0023).
 *
 * `createAdminClient` ignora RLS. Ele so pode existir onde a acao e do sistema:
 * a entrega do recovery no modo `elyra` e o dispatcher de e-mail. Um terceiro
 * import — numa rota de produto, num componente — seria bypass de RLS, e este
 * teste falha antes do review precisar perceber.
 */
const PERMITIDOS = new Set([
  "src/lib/supabase/admin.ts",
  "src/server/services/recovery-delivery-service.ts",
  "src/server/jobs/notification-email-dispatcher.ts",
  // ADR-0028: executor confiavel da verificacao profissional (evidencia e
  // decisao automatica so por RPC `_for`; o banco confere a prova de novo).
  "src/server/professional-verification/trusted-store.ts",
]);

function arquivos(dir: string): string[] {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.(ts|tsx)$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

describe("cliente service_role", () => {
  it("so os tres chamadores de sistema criam o cliente", () => {
    const fora = arquivos("src")
      .map((f) => relative(process.cwd(), f).split(sep).join("/"))
      .filter((f) => !PERMITIDOS.has(f))
      .filter((f) => /createAdminClient/.test(readFileSync(f, "utf8")));
    expect(fora).toEqual([]);
  });

  it("quem importa o modulo sem ser chamador so le a configuracao", () => {
    const importadores = arquivos("src")
      .map((f) => relative(process.cwd(), f).split(sep).join("/"))
      .filter((f) => !PERMITIDOS.has(f))
      .filter((f) => /from "@\/lib\/supabase\/admin"/.test(readFileSync(f, "utf8")));
    for (const f of importadores) {
      const linha = readFileSync(f, "utf8").match(/import \{([^}]*)\} from "@\/lib\/supabase\/admin"/)?.[1] ?? "";
      expect(linha.split(",").map((s) => s.trim()).filter(Boolean), f).toEqual(["adminClientConfigured"]);
    }
  });

  it("a chave service_role nao e lida em outro lugar de src/", () => {
    const fora = arquivos("src")
      .map((f) => relative(process.cwd(), f).split(sep).join("/"))
      .filter((f) => f !== "src/lib/supabase/admin.ts")
      .filter((f) => /process\.env\.SUPABASE_SERVICE_ROLE_KEY|env\.SUPABASE_SERVICE_ROLE_KEY/.test(readFileSync(f, "utf8")));
    expect(fora).toEqual([]);
  });

  it("nenhum componente de cliente importa o modulo", () => {
    const cliente = arquivos("src")
      .filter((f) => /^["']use client["']/m.test(readFileSync(f, "utf8")))
      .filter((f) => /supabase\/admin/.test(readFileSync(f, "utf8")));
    expect(cliente).toEqual([]);
  });
});
