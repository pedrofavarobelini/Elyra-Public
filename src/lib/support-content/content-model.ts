/**
 * SUP-3 — modelo, parser e validador dos Conteudos de Apoio (ADR-0033).
 *
 * Entrada: arquivo `content/support/<slug>.md` =
 *   ---
 *   chave: valor          (uma linha por chave; subconjunto estrito de YAML)
 *   ---
 *   corpo em Markdown RESTRITO
 *
 * Saida: `ContentItem` com o corpo ja convertido numa arvore segura
 * (`ContentBlock[]`). A UI renderiza a arvore como elementos React — nunca
 * HTML. Nada aqui executa codigo vindo do conteudo.
 *
 * Erro estrutural (frontmatter malformado, chave desconhecida) falha sempre.
 * Erro de POLITICA (fonte, revisor, datas, HTML no corpo, vocabulario) so
 * falha conteudo PUBLISHED; em DRAFT/REVIEW vira aviso, porque nao aparece.
 *
 * TS puro e imports relativos com extensao: o gerador roda no Node direto.
 */

import { auditarCopyDeTela } from "../contracts/vocabulary.ts";
import {
  AUTOMATED_REVIEWER_PATTERN,
  CONTENT_CATEGORIES,
  CONTENT_CTAS,
  CONTENT_LIMITS,
  CONTENT_SOURCES,
  CONTENT_STATUSES,
  REVIEWER_PATTERN,
  matchAllowedSource,
  type ContentCategory,
  type ContentCta,
  type ContentSourceId,
  type ContentStatus,
} from "./policy.ts";

export type ContentInline =
  | { type: "text"; value: string }
  | { type: "strong"; value: string }
  | { type: "link"; href: string; text: string };

export type ContentBlock =
  | { type: "h2"; text: string }
  | { type: "h3"; text: string }
  | { type: "p"; inlines: ContentInline[] }
  | { type: "ul"; items: ContentInline[][] };

export type ContentItem = {
  slug: string;
  title: string;
  summary: string;
  category: ContentCategory;
  publisher: ContentSourceId;
  publisherName: string;
  sourceTitle: string;
  originalUrl: string;
  publishedAt: string | null;
  lastCheckedAt: string;
  author: string | null;
  sourceLicense: string | null;
  sourceLanguage: string | null;
  reviewedAt: string;
  reviewedBy: string;
  version: number;
  status: ContentStatus;
  cta: ContentCta | null;
  readingMinutes: number;
  body: ContentBlock[];
};

export type ContentIssue = { code: string; detail: string };
export type ContentResult = {
  file: string;
  status: ContentStatus | null;
  item: ContentItem | null;
  errors: ContentIssue[];
  warnings: ContentIssue[];
};

const KNOWN_KEYS = new Set([
  "slug", "title", "summary", "category", "publisher", "source_title", "original_url",
  "published_at", "last_checked_at", "author", "source_license", "source_language",
  "reviewed_at", "reviewed_by", "version", "status", "cta",
]);
/** Imagem nao existe no V1: sem direito claro, nada de imagem de terceiro. */
const REJECTED_KEYS = new Set(["image", "image_rights", "cover", "thumbnail"]);

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+){1,8}$/;

function isRealDate(value: string) {
  if (!ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* ------------------------------------------------------------------ */
/* Frontmatter                                                        */
/* ------------------------------------------------------------------ */

export function splitFrontmatter(raw: string): { fields: Map<string, string>; body: string; errors: ContentIssue[] } {
  const errors: ContentIssue[] = [];
  const fields = new Map<string, string>();
  const text = raw.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!match) return { fields, body: "", errors: [{ code: "FRONTMATTER_MISSING", detail: "esperado bloco --- no topo" }] };
  for (const [index, line] of match[1]!.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const pair = /^([a-z_]+):\s?(.*)$/.exec(line);
    if (!pair) {
      errors.push({ code: "FRONTMATTER_SYNTAX", detail: `linha ${index + 2}` });
      continue;
    }
    const key = pair[1]!;
    let value = pair[2]!.trim();
    if (/^".*"$/.test(value)) value = value.slice(1, -1);
    if (REJECTED_KEYS.has(key)) errors.push({ code: "IMAGE_NOT_SUPPORTED_V1", detail: key });
    else if (!KNOWN_KEYS.has(key)) errors.push({ code: "FRONTMATTER_UNKNOWN_KEY", detail: key });
    else if (fields.has(key)) errors.push({ code: "FRONTMATTER_DUPLICATE_KEY", detail: key });
    else fields.set(key, value);
  }
  return { fields, body: match[2] ?? "", errors };
}

/* ------------------------------------------------------------------ */
/* Markdown restrito                                                  */
/* ------------------------------------------------------------------ */

/**
 * Suporta: `## titulo`, `### subtitulo`, paragrafo, lista `- item`,
 * `**negrito**` e `[texto](https://...)` com host na allowlist.
 * Rejeita: qualquer tag HTML, imagem, `#` (o h1 e o titulo), codigo, tabela,
 * citacao e link fora da allowlist ou sem https.
 */
export function parseRestrictedMarkdown(body: string): { blocks: ContentBlock[]; issues: ContentIssue[] } {
  const issues: ContentIssue[] = [];
  const blocks: ContentBlock[] = [];
  if (/<\s*[a-zA-Z!/?]/.test(body) || /&#|&[a-z]+;/i.test(body)) issues.push({ code: "HTML_NOT_ALLOWED", detail: "tag/entidade HTML" });
  if (/!\[/.test(body)) issues.push({ code: "IMAGE_NOT_SUPPORTED_V1", detail: "imagem no corpo" });
  if (/```|`/.test(body)) issues.push({ code: "MARKDOWN_NOT_SUPPORTED", detail: "codigo" });

  const inline = (text: string): ContentInline[] => {
    const out: ContentInline[] = [];
    const pattern = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      if (match.index! > last) out.push({ type: "text", value: text.slice(last, match.index) });
      if (match[1] !== undefined) out.push({ type: "strong", value: match[1] });
      else {
        const href = match[3]!;
        const allowed = matchAllowedSource(href);
        if (!allowed.ok) {
          issues.push({ code: `LINK_${allowed.reason}`, detail: href.slice(0, 80) });
          out.push({ type: "text", value: match[2]! });
        } else out.push({ type: "link", href: new URL(href).toString(), text: match[2]! });
      }
      last = match.index! + match[0].length;
    }
    if (last < text.length) out.push({ type: "text", value: text.slice(last) });
    return out.filter((part) => part.type !== "text" || part.value.length > 0);
  };

  const paragraphs = body.replace(/\r\n?/g, "\n").trim().split(/\n{2,}/);
  for (const chunk of paragraphs) {
    const lines = chunk.split("\n").map((line) => line.trim()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0]!;
    if (/^#\s/.test(first) || /^#{4,}/.test(first)) {
      issues.push({ code: "MARKDOWN_NOT_SUPPORTED", detail: "titulo h1 ou h4+" });
      continue;
    }
    if (/^>|^\|/.test(first)) {
      issues.push({ code: "MARKDOWN_NOT_SUPPORTED", detail: "citacao ou tabela" });
      continue;
    }
    if (/^##\s/.test(first) && lines.length === 1) blocks.push({ type: "h2", text: first.replace(/^##\s+/, "") });
    else if (/^###\s/.test(first) && lines.length === 1) blocks.push({ type: "h3", text: first.replace(/^###\s+/, "") });
    else if (lines.every((line) => /^-\s+/.test(line))) {
      blocks.push({ type: "ul", items: lines.map((line) => inline(line.replace(/^-\s+/, ""))) });
    } else blocks.push({ type: "p", inlines: inline(lines.join(" ")) });
  }
  return { blocks, issues };
}

export function plainText(blocks: ContentBlock[]): string {
  const inlineText = (parts: ContentInline[]) => parts.map((part) => (part.type === "link" ? part.text : part.value)).join("");
  return blocks
    .map((block) =>
      block.type === "p" ? inlineText(block.inlines) : block.type === "ul" ? block.items.map(inlineText).join(" ") : block.text,
    )
    .join(" ");
}

/* ------------------------------------------------------------------ */
/* Validacao                                                          */
/* ------------------------------------------------------------------ */

export function parseContentFile(file: string, raw: string): ContentResult {
  const { fields, body, errors: structural } = splitFrontmatter(raw);
  const policy: ContentIssue[] = [];
  const get = (key: string) => {
    const value = fields.get(key);
    return value === undefined || value === "" ? null : value;
  };
  const required = (key: string) => {
    const value = get(key);
    if (value === null) policy.push({ code: "FIELD_REQUIRED", detail: key });
    return value;
  };

  const statusRaw = get("status");
  const status = (CONTENT_STATUSES as readonly string[]).includes(statusRaw ?? "") ? (statusRaw as ContentStatus) : null;
  if (!status) structural.push({ code: "STATUS_INVALID", detail: String(statusRaw) });

  const slug = required("slug");
  if (slug && !SLUG.test(slug)) structural.push({ code: "SLUG_INVALID", detail: slug });
  if (slug && file && !file.endsWith(`${slug}.md`)) structural.push({ code: "SLUG_FILE_MISMATCH", detail: file });

  const title = required("title");
  if (title && title.length > CONTENT_LIMITS.titleMax) policy.push({ code: "TITLE_TOO_LONG", detail: String(title.length) });
  const summary = required("summary");
  if (summary && (summary.length < CONTENT_LIMITS.summaryMin || summary.length > CONTENT_LIMITS.summaryMax)) {
    policy.push({ code: "SUMMARY_LENGTH", detail: String(summary.length) });
  }

  const category = required("category");
  if (category && !(category in CONTENT_CATEGORIES)) policy.push({ code: "CATEGORY_INVALID", detail: category });

  const publisher = required("publisher");
  if (publisher && !(publisher in CONTENT_SOURCES)) policy.push({ code: "PUBLISHER_NOT_ALLOWED", detail: publisher });
  const sourceTitle = required("source_title");
  const originalUrl = required("original_url");
  if (originalUrl) {
    const source = matchAllowedSource(originalUrl, publisher && publisher in CONTENT_SOURCES ? publisher : undefined);
    if (!source.ok) policy.push({ code: `SOURCE_${source.reason}`, detail: originalUrl.slice(0, 80) });
  }

  for (const key of ["published_at", "last_checked_at", "reviewed_at"] as const) {
    const value = key === "published_at" ? get(key) : required(key);
    if (value && !isRealDate(value)) policy.push({ code: "DATE_INVALID", detail: key });
  }

  const reviewedBy = required("reviewed_by");
  if (reviewedBy && !REVIEWER_PATTERN.test(reviewedBy)) policy.push({ code: "REVIEWER_INVALID", detail: reviewedBy });
  if (reviewedBy && AUTOMATED_REVIEWER_PATTERN.test(reviewedBy)) {
    policy.push({ code: "REVIEWER_NOT_HUMAN", detail: "IA nao revisa nem publica" });
  }

  const versionRaw = required("version");
  const version = versionRaw && /^[1-9][0-9]{0,2}$/.test(versionRaw) ? Number(versionRaw) : null;
  if (versionRaw && version === null) policy.push({ code: "VERSION_INVALID", detail: versionRaw });

  const ctaRaw = get("cta");
  if (ctaRaw && !(ctaRaw in CONTENT_CTAS)) policy.push({ code: "CTA_INVALID", detail: ctaRaw });

  const { blocks, issues: markdownIssues } = parseRestrictedMarkdown(body);
  policy.push(...markdownIssues);
  if (body.length > CONTENT_LIMITS.bodyMax) policy.push({ code: "BODY_TOO_LONG", detail: String(body.length) });
  if (!blocks.length) policy.push({ code: "BODY_EMPTY", detail: "texto proprio da Elyra obrigatorio" });

  // Linguagem nao clinica: o mesmo gate do resto do produto.
  for (const achado of auditarCopyDeTela(`${title ?? ""} ${summary ?? ""} ${plainText(blocks)}`)) {
    policy.push({ code: `COPY_${achado.regra}`, detail: achado.termo });
  }

  const published = status === "PUBLISHED";
  const errors = [...structural, ...(published ? policy : [])];
  const warnings = published ? [] : policy;
  const words = plainText(blocks).split(/\s+/).filter(Boolean).length + (summary ?? "").split(/\s+/).length;

  const item: ContentItem | null =
    errors.length === 0 && status && slug && title && summary && category && publisher && sourceTitle && originalUrl
      ? {
          slug,
          title,
          summary,
          category: category as ContentCategory,
          publisher: publisher as ContentSourceId,
          publisherName: (CONTENT_SOURCES as Record<string, { name: string }>)[publisher]?.name ?? publisher,
          sourceTitle,
          originalUrl: originalUrl && /^https:/.test(originalUrl) ? new URL(originalUrl).toString() : originalUrl,
          publishedAt: get("published_at"),
          lastCheckedAt: get("last_checked_at") ?? "",
          author: get("author"),
          sourceLicense: get("source_license"),
          sourceLanguage: get("source_language"),
          reviewedAt: get("reviewed_at") ?? "",
          reviewedBy: reviewedBy ?? "",
          version: version ?? 0,
          status,
          cta: ctaRaw && ctaRaw in CONTENT_CTAS ? (ctaRaw as ContentCta) : null,
          readingMinutes: Math.max(1, Math.round(words / 200)),
          body: blocks,
        }
      : null;

  return { file, status, item, errors, warnings };
}

/** Corpus publicavel: so PUBLISHED; slugs unicos; ordem estavel (revisao mais recente primeiro). */
export function buildCorpus(results: ContentResult[]): { items: ContentItem[]; archived: { slug: string; title: string }[]; errors: ContentIssue[] } {
  const errors: ContentIssue[] = results.flatMap((result) => result.errors.map((error) => ({ ...error, detail: `${result.file}: ${error.detail}` })));
  const seen = new Set<string>();
  for (const result of results) {
    const slug = result.item?.slug;
    if (!slug) continue;
    if (seen.has(slug)) errors.push({ code: "SLUG_DUPLICATE", detail: slug });
    seen.add(slug);
  }
  const items = results
    .filter((result) => result.status === "PUBLISHED" && result.item)
    .map((result) => result.item!)
    .sort((a, b) => b.reviewedAt.localeCompare(a.reviewedAt) || a.title.localeCompare(b.title, "pt-BR"));
  const archived = results
    .filter((result) => result.status === "ARCHIVED" && result.item)
    .map((result) => ({ slug: result.item!.slug, title: result.item!.title }));
  return { items, archived, errors };
}
