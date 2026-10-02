import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ContentBody } from "@/components/support-content/content-body";

import { filterContent, formatContentDate, isContentCategory } from "./catalog";
import { buildCorpus, parseContentFile, parseRestrictedMarkdown, type ContentItem } from "./content-model";
import { ARCHIVED_CONTENT, PUBLISHED_CONTENT } from "./corpus.generated";
import { CONTENT_CATEGORIES, isReviewOverdue, matchAllowedSource, TRUSTED_EXTERNAL_RESOURCES } from "./policy";

const ROOT = path.resolve(__dirname, "../../..");
const CONTENT_DIR = path.join(ROOT, "content", "support");

const base = {
  slug: "exemplo-de-conteudo",
  title: "Exemplo de conteúdo",
  summary: "Um resumo próprio da Elyra com tamanho suficiente para passar pela política editorial do V1.",
  category: "buscar-ajuda",
  publisher: "ministerio-da-saude",
  source_title: "Página oficial",
  original_url: "https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/saude-mental",
  last_checked_at: "2026-09-27",
  reviewed_at: "2026-09-27",
  reviewed_by: "editorial_owner",
  version: "1",
  status: "PUBLISHED",
};

function file(fields: Record<string, string | undefined>, body = "Texto próprio e curto da Elyra.") {
  const lines = Object.entries({ ...base, ...fields })
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${body}\n`;
}
const parse = (fields: Record<string, string | undefined> = {}, body?: string) =>
  parseContentFile(`${fields.slug ?? base.slug}.md`, file(fields, body));
const codes = (result: ReturnType<typeof parse>) => result.errors.map((error) => error.code);

describe("contrato de publicacao", () => {
  it("PUBLISHED completo vira item", () => {
    const result = parse();
    expect(result.errors).toEqual([]);
    expect(result.item).toMatchObject({ slug: base.slug, status: "PUBLISHED", version: 1, reviewedBy: "editorial_owner" });
  });

  it.each([
    ["reviewed_by", "FIELD_REQUIRED"],
    ["reviewed_at", "FIELD_REQUIRED"],
    ["original_url", "FIELD_REQUIRED"],
    ["publisher", "FIELD_REQUIRED"],
    ["version", "FIELD_REQUIRED"],
    ["category", "FIELD_REQUIRED"],
  ])("PUBLISHED sem %s falha", (key, code) => {
    expect(codes(parse({ [key]: undefined }))).toContain(code);
  });

  it("categoria, versao e data invalidas falham", () => {
    expect(codes(parse({ category: "tratamentos" }))).toContain("CATEGORY_INVALID");
    expect(codes(parse({ version: "v2" }))).toContain("VERSION_INVALID");
    expect(codes(parse({ reviewed_at: "2026-02-30" }))).toContain("DATE_INVALID");
  });

  it("IA/Veltrix nao revisa nem publica: revisor automatizado reprova PUBLISHED", () => {
    for (const reviewer of ["veltrix", "claude", "ai_reviewer", "gpt_editor", "auto", "pedrocore"]) {
      expect(codes(parse({ reviewed_by: reviewer })), reviewer).toContain("REVIEWER_NOT_HUMAN");
    }
    expect(codes(parse({ reviewed_by: "Maria da Silva <maria@example.invalid>" }))).toContain("REVIEWER_INVALID");
  });

  it("so PUBLISHED entra no corpus; DRAFT/REVIEW/ARCHIVED nao aparecem", () => {
    const corpus = buildCorpus([
      parse(),
      parse({ slug: "rascunho-qualquer", status: "DRAFT", reviewed_by: undefined }),
      parse({ slug: "em-revisao-agora", status: "REVIEW", reviewed_by: undefined }),
      parse({ slug: "conteudo-antigo", status: "ARCHIVED" }),
    ]);
    expect(corpus.errors).toEqual([]);
    expect(corpus.items.map((item) => item.slug)).toEqual([base.slug]);
    expect(corpus.archived.map((item) => item.slug)).toEqual(["conteudo-antigo"]);
  });

  it("fonte fora da allowlist: DRAFT/REVIEW existem com aviso; PUBLISHED falha", () => {
    const draft = parse({ status: "DRAFT", original_url: "https://blog.qualquer.com/post" });
    expect(draft.errors).toEqual([]);
    expect(draft.warnings.map((w) => w.code)).toContain("SOURCE_DOMAIN_NOT_ALLOWED");
    expect(codes(parse({ original_url: "https://blog.qualquer.com/post" }))).toContain("SOURCE_DOMAIN_NOT_ALLOWED");
  });

  it("estrutura invalida falha em qualquer estado", () => {
    expect(codes(parse({ status: "DRAFT", image: "capa.png" }))).toContain("IMAGE_NOT_SUPPORTED_V1");
    expect(parseContentFile("x.md", "sem frontmatter").errors.map((e) => e.code)).toContain("FRONTMATTER_MISSING");
    expect(parseContentFile(`${base.slug}.md`, `---\nslug: ${base.slug}\nstatus: DRAFT\nfoo: bar\n---\nx`).errors.map((e) => e.code)).toContain(
      "FRONTMATTER_UNKNOWN_KEY",
    );
    expect(parseContentFile("outro-nome.md", file({})).errors.map((e) => e.code)).toContain("SLUG_FILE_MISMATCH");
  });

  it("slug duplicado falha o corpus", () => {
    expect(buildCorpus([parse(), parse()]).errors.map((e) => e.code)).toContain("SLUG_DUPLICATE");
  });
});

describe("allowlist de fontes e URLs", () => {
  it.each([
    ["http://www.gov.br/saude/x", "URL_NOT_HTTPS"],
    ["javascript:alert(1)", "URL_NOT_HTTPS"],
    ["data:text/html,<script>alert(1)</script>", "URL_NOT_HTTPS"],
    ["file:///etc/passwd", "URL_NOT_HTTPS"],
    ["nao e url", "URL_INVALID"],
    ["https://user:pw@www.gov.br/saude/x", "URL_INVALID"],
    ["https://www.gov.br.evil.com/saude/x", "DOMAIN_NOT_ALLOWED"],
    ["https://evilgov.br/saude/x", "DOMAIN_NOT_ALLOWED"],
    ["https://www.gov.br/mec/x", "DOMAIN_NOT_ALLOWED"],
  ])("recusa %s", (url, reason) => {
    expect(matchAllowedSource(url)).toEqual({ ok: false, reason });
  });

  it("fonte divergente do dominio: publisher precisa casar com o host", () => {
    expect(matchAllowedSource("https://cvv.org.br/o-cvv/", "ministerio-da-saude")).toEqual({
      ok: false,
      reason: "PUBLISHER_DOMAIN_MISMATCH",
    });
    expect(matchAllowedSource("https://www.gov.br/anpd/pt-br/x", "ministerio-da-saude").ok).toBe(false);
    expect(matchAllowedSource("https://www.gov.br/anpd/pt-br/x", "anpd").ok).toBe(true);
  });
});

describe("markdown restrito e XSS", () => {
  it.each([
    ["<script>alert(1)</script>", "HTML_NOT_ALLOWED"],
    ['<img src=x onerror="alert(1)">', "HTML_NOT_ALLOWED"],
    ['<iframe src="https://x"></iframe>', "HTML_NOT_ALLOWED"],
    ["&lt;script&gt;", "HTML_NOT_ALLOWED"],
    ["[clique](javascript:alert(1))", "LINK_URL_NOT_HTTPS"],
    ["[clique](https://evil.example/)", "LINK_DOMAIN_NOT_ALLOWED"],
    ["![foto](https://www.gov.br/saude/a.png)", "IMAGE_NOT_SUPPORTED_V1"],
    ["# Outro titulo", "MARKDOWN_NOT_SUPPORTED"],
    ["`codigo`", "MARKDOWN_NOT_SUPPORTED"],
  ])("rejeita %s", (body, code) => {
    expect(parseRestrictedMarkdown(body).issues.map((issue) => issue.code)).toContain(code);
    expect(codes(parse({}, body))).toContain(code);
  });

  it("link malicioso vira texto, nunca <a>", () => {
    const { blocks } = parseRestrictedMarkdown("veja [aqui](javascript:alert(1)) agora");
    expect(JSON.stringify(blocks)).not.toContain("javascript:");
  });

  it("renderer nao produz script/iframe/handler nem com texto hostil", () => {
    const { container } = render(
      <ContentBody
        blocks={[
          { type: "p", inlines: [{ type: "text", value: "<script>alert(1)</script><img src=x onerror=alert(1)>" }] },
          { type: "p", inlines: [{ type: "link", href: "javascript:alert(1)", text: "x" }] },
          { type: "p", inlines: [{ type: "link", href: "https://cvv.org.br/o-cvv/", text: "CVV" }] },
        ]}
      />,
    );
    expect(container.querySelector("script, iframe, img, [onerror]")).toBeNull();
    const links = [...container.querySelectorAll("a")];
    expect(links.map((a) => a.getAttribute("href"))).toEqual(["https://cvv.org.br/o-cvv/"]);
    expect(links[0]!.getAttribute("rel")).toBe("noopener noreferrer");
    expect(links[0]!.textContent).toContain("abre em nova aba");
  });
});

describe("linguagem nao clinica", () => {
  it("termo clinico reprova PUBLISHED", () => {
    expect(codes(parse({}, "Isto é um diagnóstico."))).toEqual(expect.arrayContaining([expect.stringMatching(/^COPY_/)]));
    expect(codes(parse({ summary: "Um texto que afirma que dormir pouco causou a queda de humor, o que é causal e proibido." }))).toEqual(
      expect.arrayContaining([expect.stringMatching(/^COPY_/)]),
    );
  });
});

describe("frescor editorial", () => {
  it("revisao com mais de 365 dias fica REVIEW_OVERDUE (sem sair do ar)", () => {
    expect(isReviewOverdue("2026-09-27", "2027-09-27")).toBe(false);
    expect(isReviewOverdue("2025-09-26", "2026-09-27")).toBe(true);
  });
});

describe("busca e filtro no cliente", () => {
  const items = [
    { ...parse().item!, slug: "a-b", title: "Onde procurar cuidado", category: "buscar-ajuda" },
    { ...parse().item!, slug: "c-d", title: "Rede psicossocial", summary: "CAPS e atenção primária.", category: "rede-publica" },
  ] as ContentItem[];
  it("sem acento, sem caixa, por categoria", () => {
    expect(filterContent(items, "ATENCAO", null).map((i) => i.slug)).toEqual(["c-d"]);
    expect(filterContent(items, "", "buscar-ajuda").map((i) => i.slug)).toEqual(["a-b"]);
    expect(filterContent(items, "caps", "buscar-ajuda")).toEqual([]);
    expect(isContentCategory("rede-publica")).toBe(true);
    expect(isContentCategory("__proto__")).toBe(false);
    expect(formatContentDate("2026-09-27")).toBe("27/09/2026");
  });
  it("taxonomia pequena", () => {
    expect(Object.keys(CONTENT_CATEGORIES).length).toBeLessThanOrEqual(6);
  });
});

describe("conteudo real do repositorio", () => {
  const files = readdirSync(CONTENT_DIR).filter((name) => name.endsWith(".md") && name !== "README.md");
  const results = files.map((name) => parseContentFile(name, readFileSync(path.join(CONTENT_DIR, name), "utf8")));

  it("conjunto inicial pequeno (6 a 10) e sem erro", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
    expect(files.length).toBeLessThanOrEqual(10);
    expect(buildCorpus(results).errors).toEqual([]);
  });

  it("nenhum conteudo foi publicado por IA: sem revisor humano, fica em REVIEW", () => {
    for (const result of results) {
      if (result.status === "PUBLISHED") {
        expect(result.item?.reviewedBy, result.file).toMatch(/^[a-z][a-z0-9_]{2,40}$/);
      }
    }
  });

  it("cada conteudo em REVIEW passaria como PUBLISHED assim que um revisor humano assinar", () => {
    for (const name of files) {
      const raw = readFileSync(path.join(CONTENT_DIR, name), "utf8");
      if (!/\nstatus: REVIEW\n/.test(raw)) continue;
      const signed = raw.replace("status: REVIEW", "status: PUBLISHED\nreviewed_by: editorial_owner\nreviewed_at: 2026-09-27");
      const result = parseContentFile(name, signed);
      expect(result.errors, name).toEqual([]);
    }
  });

  it("gerado em dia com o Markdown (drift)", () => {
    const output = execFileSync(process.execPath, ["scripts/build-support-content.mjs", "--check"], { cwd: ROOT, encoding: "utf8" });
    expect(output).toMatch(/SUPPORT_CONTENT=PASS/);
    expect(PUBLISHED_CONTENT.every((item) => item.status === "PUBLISHED")).toBe(true);
    expect(ARCHIVED_CONTENT.length).toBeGreaterThanOrEqual(0);
  });
});

describe("Rede de Apoio editorial — ajuda e informacao externa", () => {
  it("todo recurso externo e https, passa pela allowlist e bate com o publisher declarado", () => {
    expect(TRUSTED_EXTERNAL_RESOURCES.length).toBeGreaterThan(0);
    for (const resource of TRUSTED_EXTERNAL_RESOURCES) {
      expect(resource.url.startsWith("https://")).toBe(true);
      expect(matchAllowedSource(resource.url, resource.source)).toEqual({ ok: true });
      expect(resource.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
