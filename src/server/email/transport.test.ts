import { describe, expect, it } from "vitest";

import {
  EMAIL_FORBIDDEN_TERMS,
  EMAIL_TEMPLATES,
  allEmailCopy,
} from "@/server/email/templates";
import {
  emailDeliveryAvailable,
  emailTransportKind,
} from "@/server/email/transport";
import { NOTIFICATION_KINDS } from "@/lib/contracts/notifications";

/**
 * Capability de transporte e copy dos templates.
 *
 * Duas coisas que precisam ser verdade **antes** de qualquer entrega existir: o
 * canal so se declara disponivel quando ha transporte real, e o texto que sai
 * daqui nao carrega nada que a pessoa nao gostaria de ver na tela de bloqueio.
 */

describe("o canal existe sempre; a entrega depende do ambiente", () => {
  it("sem transporte declarado, nao ha entrega", () => {
    expect(emailDeliveryAvailable({})).toBe(false);
    expect(emailTransportKind({})).toBeNull();
  });

  it("valor desconhecido nao vira transporte", () => {
    // Falha fechada: um typo em variavel de ambiente nao pode ligar um canal.
    expect(
      emailTransportKind({ ELYRA_EMAIL_TRANSPORT: "sendgrid" }),
    ).toBeNull();
    expect(
      emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "sendgrid" }),
    ).toBe(false);
  });

  it("captura local basta para QA", () => {
    expect(
      emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "local_capture" }),
    ).toBe(true);
  });

  it("Brevo sem chave NAO e transporte configurado", () => {
    /*
      O caso que mais tentaria um atalho: declarar o provedor e considerar o
      canal disponivel. A tela ofereceria um interruptor que falharia na
      primeira entrega.
    */
    expect(emailDeliveryAvailable({ ELYRA_EMAIL_TRANSPORT: "brevo" })).toBe(
      false,
    );
    expect(
      emailDeliveryAvailable({
        ELYRA_EMAIL_TRANSPORT: "brevo",
        BREVO_API_KEY: "   ",
      }),
    ).toBe(false);
  });

  it("Brevo com chave, remetente e transporte configurado", () => {

    expect(
      emailDeliveryAvailable({
        ELYRA_EMAIL_TRANSPORT: "brevo",
        BREVO_API_KEY: "chave-de-teste",
        ELYRA_EMAIL_SENDER_ADDRESS: "nao-responda@example.invalid",
      }),
    ).toBe(true);
  });

  it("a disponibilidade de e-mail nao depende das chaves de push", () => {
    // O defeito que a extensao quase introduziu: um filtro compartilhado fazia
    // e-mail herdar a configuracao do `web_push`.
    expect(
      emailDeliveryAvailable({
        ELYRA_WEB_PUSH_PUBLIC_KEY: "pub",
        ELYRA_WEB_PUSH_PRIVATE_KEY: "priv",
      }),
    ).toBe(false);
  });
});

describe("o e-mail carrega o convite, e nunca o conteudo", () => {
  it("ha template para cada tipo entregavel", () => {
    for (const kind of NOTIFICATION_KINDS) {
      expect(EMAIL_TEMPLATES[kind]?.subject.length).toBeGreaterThan(0);
      expect(EMAIL_TEMPLATES[kind]?.body.length).toBeGreaterThan(0);
    }
  });

  it("nenhum termo proibido aparece em assunto ou corpo", () => {
    /*
      Assunto e previa aparecem em tela bloqueada, relogio e caixa compartilhada.
      A lista cobre as duas formas de errar: conteudo sensivel e copy de
      cobranca.
    */
    const copy = allEmailCopy();
    const encontrados = EMAIL_FORBIDDEN_TERMS.filter((termo) =>
      copy.includes(termo.toLowerCase()),
    );
    expect(encontrados, "termo proibido na copy de e-mail").toEqual([]);
  });

  it("o convite aponta para dentro do produto", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const path = EMAIL_TEMPLATES[kind]?.path ?? "";
      expect(path.startsWith("/"), `${kind} deve apontar para caminho interno`).toBe(
        true,
      );
      expect(path.startsWith("//")).toBe(false);
      expect(path).not.toContain("http");
    }
  });

  it("nenhum template promete lembrete de consulta", () => {
    // Nao existe dominio de agenda no produto; prometer isso seria inventar o
    // fato antes da funcionalidade.
    const copy = allEmailCopy();
    expect(copy).not.toContain("consulta");
    expect(copy).not.toContain("agendament");
  });
});
