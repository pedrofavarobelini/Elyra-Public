/**
 * SUP-3 — politica editorial dos Conteudos de Apoio (ADR-0033). UNICO lugar
 * com categorias, fontes permitidas, estados e regras de revisao.
 *
 * TS puro, sem alias `@/` nem sintaxe so-TS: o gerador
 * (`scripts/build-support-content.mjs`) importa este arquivo direto no Node.
 *
 * A Elyra e CURADORA, nao republicadora: cada conteudo tem resumo e texto
 * proprios, curtos, e aponta para a fonte original. Nada e copiado.
 */

export const CONTENT_STATUSES = ["DRAFT", "REVIEW", "PUBLISHED", "ARCHIVED"] as const;
export type ContentStatus = (typeof CONTENT_STATUSES)[number];

/**
 * Taxonomia pequena de proposito (cinco). Da proposta historica sairam:
 * "primeira consulta" (junta com escolher profissional), "direitos" e
 * "privacidade" (um so tema para a pessoa: o que ela pode exigir) e "Elyra"
 * (uso da propria Elyra e ajuda do produto, nao curadoria de fonte externa).
 */
export const CONTENT_CATEGORIES = {
  "buscar-ajuda": { label: "Buscar ajuda", description: "Onde e como procurar apoio." },
  "rede-publica": { label: "Rede pública", description: "Como o SUS organiza o cuidado." },
  profissionais: { label: "Profissionais e consultas", description: "Como escolher e o que esperar." },
  "direitos-e-privacidade": { label: "Direitos e privacidade", description: "O que você pode exigir." },
  autocuidado: { label: "Autocuidado", description: "Materiais para o dia a dia." },
} as const;
export type ContentCategory = keyof typeof CONTENT_CATEGORIES;

/**
 * Fontes permitidas para conteudo PUBLICADO. Host EXATO (nada de sufixo
 * solto: `evil-gov.br` nao passa) e, quando o host e compartilhado (gov.br),
 * prefixo de caminho do orgao. `publisher` do conteudo precisa casar com o
 * host da URL original: fonte divergente do dominio falha.
 */
export const CONTENT_SOURCES = {
  "ministerio-da-saude": {
    name: "Ministério da Saúde",
    origins: [
      { host: "www.gov.br", pathPrefix: "/saude/" },
      { host: "bvsms.saude.gov.br", pathPrefix: "/" },
    ],
  },
  anpd: {
    name: "Autoridade Nacional de Proteção de Dados (ANPD)",
    origins: [{ host: "www.gov.br", pathPrefix: "/anpd/" }],
  },
  fiocruz: {
    name: "Fiocruz",
    origins: [
      { host: "portal.fiocruz.br", pathPrefix: "/" },
      { host: "www.fiocruz.br", pathPrefix: "/" },
    ],
  },
  opas: { name: "Organização Pan-Americana da Saúde (OPAS/OMS)", origins: [{ host: "www.paho.org", pathPrefix: "/" }] },
  oms: { name: "Organização Mundial da Saúde (OMS)", origins: [{ host: "www.who.int", pathPrefix: "/" }] },
  cvv: {
    name: "CVV — Centro de Valorização da Vida",
    origins: [
      { host: "cvv.org.br", pathPrefix: "/" },
      { host: "www.cvv.org.br", pathPrefix: "/" },
    ],
  },
  cfp: {
    name: "Conselho Federal de Psicologia (CFP)",
    origins: [
      { host: "site.cfp.org.br", pathPrefix: "/" },
      { host: "cadastro.cfp.org.br", pathPrefix: "/" },
    ],
  },

  "vita-alere": {
    name: "Instituto Vita Alere de Prevenção e Posvenção do Suicídio",
    origins: [{ host: "vitaalere.com.br", pathPrefix: "/" }],
  },
  asec: {
    name: "ASEc+ — Associação pela Saúde Emocional",
    origins: [{ host: "asecbrasil.org.br", pathPrefix: "/" }],
  },
} as const;
export type ContentSourceId = keyof typeof CONTENT_SOURCES;


export const TRUSTED_EXTERNAL_RESOURCES = [
  {
    id: "ministerio-da-saude-saude-mental",
    source: "ministerio-da-saude",
    title: "Saúde mental no SUS",
    description:
      "Página oficial do Ministério da Saúde sobre saúde mental: como a rede de atenção psicossocial se organiza e onde procurar cuidado.",
    url: "https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/saude-mental",
    verifiedAt: "2026-09-27",
  },
  {
    // Fundado em 2013; primeiro instituto brasileiro associado a IASP. Verificado por busca em 27/09/2026.
    id: "vita-alere",
    source: "vita-alere",
    title: "Instituto Vita Alere",
    description:
      "Organização da sociedade civil dedicada à prevenção do suicídio e ao apoio a quem perdeu alguém por suicídio (posvenção), com materiais educativos e grupos de apoio.",
    url: "https://vitaalere.com.br/",
    verifiedAt: "2026-09-27",
  },
  {
    // OSC sem fins lucrativos fundada em 2004 por voluntarios do CVV. Verificada por busca em 27/09/2026.
    id: "asec",
    source: "asec",
    title: "ASEc+ — Associação pela Saúde Emocional",
    description:
      "Associação sem fins lucrativos que promove saúde emocional de crianças, jovens e educadores, com programas de habilidades para a vida nas escolas.",
    url: "https://asecbrasil.org.br/",
    verifiedAt: "2026-09-27",
  },
] as const satisfies ReadonlyArray<{
  id: string;
  source: ContentSourceId;
  title: string;
  description: string;
  url: string;
  verifiedAt: string;
}>;

/** Chamadas para outras areas da Elyra (nunca executam nada sozinhas). */
export const CONTENT_CTAS = {
  "rede-de-apoio": { href: "/rede-de-apoio", label: "Ver Rede de Apoio" },
  profissionais: { href: "/profissionais", label: "Encontrar profissionais" },
  sos: { href: "#contatos-de-ajuda", label: "Ver contatos de ajuda imediata" },
} as const;
export type ContentCta = keyof typeof CONTENT_CTAS;

/**
 * Revisao humana. `reviewed_by` e um identificador FUNCIONAL (sem nome de
 * pessoa, e-mail nem dado pessoal): quem revisa responde pelo merge no Git.
 * Nenhum identificador de IA pode revisar: IA/Veltrix pode sugerir rascunho,
 * nunca publicar nem ser o revisor de um PUBLISHED.
 */
export const REVIEWER_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;
export const AUTOMATED_REVIEWER_PATTERN = /(^|_)(ai|ia|bot|llm|gpt|claude|gemini|veltrix|pedrocore|auto|automatic|automatico)(_|$)/;


export const CONTENT_REVIEW_INTERVAL_DAYS = 365;

export const CONTENT_LIMITS = {
  titleMax: 90,
  summaryMin: 60,
  summaryMax: 280,

  // SUPPORT_ARTICLES_DEPTH = NEEDS_REWORK). Continua proibido copiar a fonte.
  bodyMax: 12000,
  versionMax: 999,
} as const;

export type SourceMatch = { ok: true } | { ok: false; reason: "URL_INVALID" | "URL_NOT_HTTPS" | "DOMAIN_NOT_ALLOWED" | "PUBLISHER_DOMAIN_MISMATCH" };

/** URL https, host exato da allowlist e, se informado, do MESMO publisher. */
export function matchAllowedSource(raw: string, publisher?: string): SourceMatch {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "URL_INVALID" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "URL_NOT_HTTPS" };
  if (url.username || url.password || url.port) return { ok: false, reason: "URL_INVALID" };
  const allows = (id: string) =>
    (CONTENT_SOURCES as Record<string, { origins: readonly { host: string; pathPrefix: string }[] }>)[id]?.origins.some(
      (origin) => origin.host === url.hostname && url.pathname.startsWith(origin.pathPrefix),
    ) ?? false;
  const anyAllowed = Object.keys(CONTENT_SOURCES).some(allows);
  if (!anyAllowed) return { ok: false, reason: "DOMAIN_NOT_ALLOWED" };
  if (publisher !== undefined && !allows(publisher)) return { ok: false, reason: "PUBLISHER_DOMAIN_MISMATCH" };
  return { ok: true };
}

export function isReviewOverdue(reviewedAt: string, today: string): boolean {
  const reviewed = Date.parse(`${reviewedAt}T00:00:00Z`);
  const now = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(reviewed) || !Number.isFinite(now)) return true;
  return now - reviewed > CONTENT_REVIEW_INTERVAL_DAYS * 86_400_000;
}
