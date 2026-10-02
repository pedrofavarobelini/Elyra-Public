import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EMAIL_LAYOUT_ID } from "@/server/email/layout";
import {
  EMAIL_FORBIDDEN_TERMS,
  RECOVERY_EMAIL_SUBJECT,
  RECOVERY_LINK_VALIDITY,
  renderRecoveryEmail,
} from "@/server/email/templates";

const LINK = "http://localhost:3000/redefinir-senha/confirmar?token_hash=" + "a".repeat(56);

describe("e-mail de redefinicao de senha", () => {
  const m = renderRecoveryEmail(LINK);

  it("assunto, CTA, prazo, uso unico e instrucao de ignorar", () => {
    expect(m.subject).toBe("Redefina sua senha da Elyra");
    expect(RECOVERY_EMAIL_SUBJECT).toBe(m.subject);
    expect(m.body).toContain(LINK);
    expect(m.body).toContain(RECOVERY_LINK_VALIDITY);
    expect(m.body).toContain("só pode ser usado uma vez");
    expect(m.body).toContain("ignore este e-mail");
    expect(m.body).toContain("nunca pede sua senha");
    expect(m.html).toContain(`data-elyra-email-layout="${EMAIL_LAYOUT_ID}"`);
    expect(m.html).toContain("Criar uma nova senha");
    expect(m.html).toContain(LINK);
  });

  it("sem conteudo sensivel nem copy de cobranca", () => {
    const texto = `${m.subject} ${m.body} ${m.html}`.toLowerCase();
    for (const termo of EMAIL_FORBIDDEN_TERMS) expect(texto, termo).not.toContain(termo.toLowerCase());
  });

  it("valor dinamico e escapado: link malicioso nao injeta HTML", () => {
    const malicioso = renderRecoveryEmail('http://x/"><script>alert(1)</script>');
    expect(malicioso.html).not.toContain("<script>");
    expect(malicioso.html).toContain("&lt;script&gt;");
  });

  it("assunto sem quebra de linha (sem injecao de cabecalho)", () => {
    expect(m.subject).not.toMatch(/[\r\n]/);
  });
});
