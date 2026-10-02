import "server-only";

/**
 * Layout unico dos e-mails da Elyra.
 *
 * A base usa tabelas de apresentacao e estilos inline porque o HTML precisa
 * continuar legivel em clientes conservadores. O pequeno `<style>` no cabecalho
 * adiciona responsividade e dark mode como melhoria progressiva; se ele for
 * removido, o contraste e a hierarquia do modo claro permanecem completos.
 *
 * A marca e texto de proposito. Os PNGs oficiais nao tem uma URL publica
 * estavel neste ambiente, e embuti-los em base64 aumentaria muito a mensagem.
 * Texto evita cabecalho vazio quando imagens externas sao bloqueadas.
 */

const COR = {
  interacao: "#5256d4",
  interacaoEscura: "#4347b6",
  identidade: "#1a555c",
  texto: "#1e2142",
  textoSuave: "#535670",
  borda: "#e8e9f3",
  fundo: "#f5f6fb",
  superficieSuave: "#f7f8fc",
} as const;

/** Marcador estavel para provar que todos os templates usam esta base. */
export const EMAIL_LAYOUT_ID = "elyra-transactional-v2";

export interface EmailLayoutInput {
  title: string;
  /** Texto curto exibido por alguns clientes ao lado do assunto. */
  preheader?: string;
  /** Paragrafos do corpo. Cada item vira um `<p>`. */
  paragraphs: string[];
  /** Convite para abrir o produto, quando houver. */
  cta?: { label: string; url: string };
  /** Por que esta mensagem chegou — sempre presente. */
  footer: string;
  /** Caminho autenticado para a pessoa administrar o recebimento. */
  footerLink?: { label: string; url: string };
}

/** Escapa todo valor dinamico antes de entrar na marcacao. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderEmailHtml(input: EmailLayoutInput): string {
  const paragrafos = input.paragraphs
    .map(
      (texto) =>
        `<p class="elyra-copy" style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.65;color:${COR.texto};">${escapeHtml(texto)}</p>`,
    )
    .join("");

  const cta = input.cta
    ? `<table class="elyra-cta-table" role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:26px 0 0;">
<tr><td align="center" bgcolor="${COR.interacao}" style="background:${COR.interacao};border-radius:10px;mso-padding-alt:13px 24px;">
<a class="elyra-cta-link" href="${escapeHtml(input.cta.url)}" style="display:inline-block;padding:13px 24px;border:1px solid ${COR.interacaoEscura};border-radius:10px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:16px;line-height:1.25;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(input.cta.label)}</a>
</td></tr>
</table>
<p class="elyra-muted" style="margin:22px 0 7px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.55;color:${COR.textoSuave};">Se o botão não abrir, copie e cole este endereço no navegador:</p>
<p class="elyra-url" style="margin:0;padding:11px 12px;background:${COR.superficieSuave};border:1px solid ${COR.borda};border-radius:8px;font-family:Consolas,'Courier New',monospace;font-size:12px;line-height:1.5;word-break:break-all;"><a class="elyra-link" href="${escapeHtml(input.cta.url)}" style="color:${COR.interacaoEscura};text-decoration:underline;">${escapeHtml(input.cta.url)}</a></p>`
    : "";

  const footerLink = input.footerLink
    ? `<p class="elyra-muted" style="margin:10px 0 0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:${COR.textoSuave};"><a class="elyra-link" href="${escapeHtml(input.footerLink.url)}" style="color:${COR.interacaoEscura};font-weight:600;text-decoration:underline;">${escapeHtml(input.footerLink.label)}</a></p>`
    : "";

  const preheader = escapeHtml(input.preheader ?? input.title);

  /* `role="presentation"` impede leitores de tela de anunciar tabelas de dados. */
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(input.title)}</title>
<style>
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media only screen and (max-width:620px) {
  .elyra-shell { padding:16px 8px !important; }
  .elyra-header, .elyra-content, .elyra-footer { padding-left:20px !important; padding-right:20px !important; }
  .elyra-title { font-size:23px !important; }
  .elyra-cta-table, .elyra-cta-link { width:100% !important; }
  .elyra-cta-link { box-sizing:border-box !important; text-align:center !important; }
}
@media (prefers-color-scheme:dark) {
  body, .elyra-shell { background:#121526 !important; }
  .elyra-card, .elyra-content { background:#1e2142 !important; }
  .elyra-header { background:#1a555c !important; }
  .elyra-title, .elyra-copy { color:#ffffff !important; }
  .elyra-muted { color:#d2d4fb !important; }
  .elyra-footer, .elyra-url { background:#2d2f49 !important; border-color:#535670 !important; }
  .elyra-link { color:#b2b5f7 !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:${COR.fundo};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">${preheader}</div>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="${COR.fundo}" style="width:100%;background:${COR.fundo};">
<tr><td class="elyra-shell" align="center" style="padding:32px 12px;">
<!--[if mso]><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
<table class="elyra-card" data-elyra-email-layout="${EMAIL_LAYOUT_ID}" role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ${COR.borda};border-collapse:separate;border-radius:14px;overflow:hidden;">
<tr><td class="elyra-header" bgcolor="${COR.identidade}" style="padding:23px 32px;background:${COR.identidade};border-radius:13px 13px 0 0;">
<p style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:19px;line-height:1;font-weight:800;letter-spacing:0.12em;color:#ffffff;">ELYRA</p>
</td></tr>
<tr><td class="elyra-content" style="padding:32px 32px 30px;background:#ffffff;">
<h1 class="elyra-title" style="margin:0 0 18px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:26px;line-height:1.3;font-weight:700;letter-spacing:-0.02em;color:${COR.texto};">${escapeHtml(input.title)}</h1>
${paragrafos}${cta}
</td></tr>
<tr><td class="elyra-footer" style="padding:22px 32px 25px;background:${COR.superficieSuave};border-top:1px solid ${COR.borda};border-radius:0 0 13px 13px;">
<p class="elyra-muted" style="margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;font-size:13px;line-height:1.6;color:${COR.textoSuave};">${escapeHtml(input.footer)}</p>
${footerLink}
</td></tr>
</table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr>
</table>
</body>
</html>`;
}
