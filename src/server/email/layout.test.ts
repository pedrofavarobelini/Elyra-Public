import { describe, expect, it } from "vitest";

import { NOTIFICATION_KINDS } from "@/lib/contracts/notifications";
import {
  EMAIL_LAYOUT_ID,
  escapeHtml,
  renderEmailHtml,
} from "@/server/email/layout";
import {
  EMAIL_FORBIDDEN_TERMS,
  EMAIL_FOOTER,
  renderEmailMessage,
} from "@/server/email/templates";

const BASE_URL = "https://app.elyra.invalid";

describe("layout-base dos e-mails", () => {
  it("escapa titulo, copy, rotulo, URLs e rodape", () => {
    const html = renderEmailHtml({
      title: 'Confirmação <Elyra> & "você"',
      preheader: "Prévia <privada>",
      paragraphs: ['<script>alert("x")</script> & conteúdo'],
      cta: {
        label: "Abrir <agora>",
        url: 'https://elyra.invalid/?a=1&b="x"',
      },
      footer: "Rodapé 'seguro' & claro",
      footerLink: {
        label: "Preferências <Elyra>",
        url: "https://elyra.invalid/notificacoes?a=1&b=2",
      },
    });

    expect(html).toContain(escapeHtml('Confirmação <Elyra> & "você"'));
    expect(html).toContain("Prévia &lt;privada&gt;");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("Abrir &lt;agora&gt;");
    expect(html).toContain("a=1&amp;b=&quot;x&quot;");
    expect(html).toContain("Rodapé &#39;seguro&#39; &amp; claro");
    expect(html).toContain("Preferências &lt;Elyra&gt;");
  });

  it("usa HTML conservador com fallback responsivo e de dark mode", () => {
    const html = renderEmailHtml({
      title: "Elyra",
      paragraphs: ["Mensagem"],
      cta: { label: "Abrir o Elyra", url: BASE_URL },
      footer: "Rodapé",
    });

    expect(html).toContain('<meta name="viewport"');
    expect(html).toContain('<meta name="color-scheme" content="light dark">');
    expect(html).toContain("prefers-color-scheme:dark");
    expect(html).toContain("max-width:600px");
    expect(html).toContain('role="presentation"');
    expect(html).toContain('style="');
    expect(html).not.toMatch(/display\s*:\s*(?:flex|grid)/i);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("base64");
  });

  it("mostra CTA, URL alternativa e rodape sem depender de imagem", () => {
    const html = renderEmailHtml({
      title: "Aviso do Elyra",
      paragraphs: ["Mensagem"],
      cta: { label: "Abrir o Elyra", url: `${BASE_URL}/dashboard?a=1&b=2` },
      footer: "Você recebeu este aviso por causa das suas preferências.",
    });

    expect(html).toContain(">ELYRA</p>");
    expect(html).toContain(">Abrir o Elyra</a>");
    expect(html).toContain("Se o botão não abrir");
    // URL aparece nos dois `href` e uma vez como fallback visivel.
    expect(html.match(/dashboard\?a=1&amp;b=2/g)).toHaveLength(3);
    expect(html).toContain("Você recebeu este aviso");
  });
});

describe("mensagens renderizadas", () => {
  it("reutilizam a mesma base, com titulo, CTA, rodape e texto puro completo", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const message = renderEmailMessage(kind, `${BASE_URL}/`);

      expect(message.html).toContain(
        `data-elyra-email-layout="${EMAIL_LAYOUT_ID}"`,
      );
      expect(message.html).toContain(`<title>${message.subject}</title>`);
      expect(message.html).toContain(">Abrir o Elyra</a>");
      expect(message.html).toContain(EMAIL_FOOTER);
      expect(message.html).toContain(`${BASE_URL}/notificacoes`);
      expect(message.body).toContain("Abrir o Elyra: https://");
      expect(message.body).toContain(EMAIL_FOOTER);
      expect(message.body).toContain(
        `Gerencie suas preferências: ${BASE_URL}/notificacoes`,
      );
    }
  });

  it("preserva UTF-8 e acentos no assunto, HTML e texto puro", () => {
    const message = renderEmailMessage("checkin_reminder", BASE_URL);
    expect(message.subject).toContain("Há");
    expect(message.html).toContain('<meta charset="utf-8">');
    expect(message.html).toContain("botão");
    expect(message.html).toContain("notificações");
    expect(message.body).toContain("preferências");
  });

  it("nao expoe categoria sensivel, segredo ou chave em nenhuma representacao", () => {
    for (const kind of NOTIFICATION_KINDS) {
      const message = renderEmailMessage(kind, BASE_URL);
      const rendered = `${message.subject} ${message.body} ${message.html}`.toLowerCase();

      for (const term of EMAIL_FORBIDDEN_TERMS) {
        expect(rendered, `${kind}: termo proibido ${term}`).not.toContain(
          term.toLowerCase(),
        );
      }
      expect(rendered).not.toContain("brevo_api_key");
      expect(rendered).not.toContain("api-key");
      expect(rendered).not.toMatch(/xkeysib-[a-z0-9_-]+/i);
    }
  });
});
