import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import {
  DECLARED_API_ROUTES,
  INTERNAL_SECRET_ROUTES,
  PRE_CONSENT_ALLOWED_ROUTES,
  PUBLIC_API_ROUTES,
  REQUIRES_TERMS_ROUTES,
  classifyApiRoute,
} from "@/server/api-consent-policy";



const API_ROOT = join(process.cwd(), "src", "app", "api");

/** Todos os `route.ts` sob `src/app/api`, no formato `api/x/y`. */
function discoverApiRoutes(dir: string = API_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...discoverApiRoutes(full));
    } else if (entry.name === "route.ts") {
      const dirRelative = relative(join(process.cwd(), "src", "app"), dir);
      found.push(dirRelative.split(sep).join("/"));
    }
  }
  return found.sort();
}

const DISCOVERED = discoverApiRoutes();

function sourceOf(route: string): string {
  return readFileSync(join(process.cwd(), "src", "app", route, "route.ts"), "utf8");
}

describe("classificacao de consentimento das rotas de API", () => {
  it("encontra rotas no disco — se nao encontrar, a guarda nao guarda nada", () => {
    // Sem esta assercao, um erro de caminho faria todas as outras passarem por
    // vacuidade: zero rotas descobertas satisfaz "toda rota esta classificada".
    expect(DISCOVERED.length).toBeGreaterThan(20);
  });

  it("toda rota existente esta classificada", () => {
    const semClasse = DISCOVERED.filter((route) => classifyApiRoute(route) === null);
    expect(
      semClasse,
      "rota de API sem classificacao de consentimento: declare em api-consent-policy.ts",
    ).toEqual([]);
  });

  it("nenhuma rota declarada deixou de existir", () => {
    // Entrada orfa e pior que ausente: ela sugere cobertura que nao ha.
    const fantasmas = DECLARED_API_ROUTES.filter(
      (route) => !DISCOVERED.includes(route),
    );
    expect(fantasmas, "rota declarada que nao existe mais no disco").toEqual([]);
  });

  it("nenhuma rota aparece em duas classes", () => {
    const vistas = new Set<string>();
    const repetidas: string[] = [];
    for (const route of DECLARED_API_ROUTES) {
      if (vistas.has(route)) repetidas.push(route);
      vistas.add(route);
    }
    expect(repetidas).toEqual([]);
  });
});

describe("o portao esta mesmo aplicado, e nao apenas declarado", () => {
  it("toda rota REQUIRES_TERMS importa o portao consentido", () => {
    // F1: `getVerifiedProfessionalApiUser` e o portao consentido + estado
    // VERIFIED (ele chama `getConsentedApiUser` por dentro) — conta como portao.
    const desprotegidas = REQUIRES_TERMS_ROUTES.filter(
      (route) => !/getConsentedApiUser|getVerifiedProfessionalApiUser/.test(sourceOf(route)),
    );
    expect(
      desprotegidas,
      "rota classificada como REQUIRES_TERMS que nao usa getConsentedApiUser",
    ).toEqual([]);
  });

  it("nenhuma rota REQUIRES_TERMS ficou com o funil simples", () => {
    /*
      `getAuthenticatedUser` continua legitimo — e o funil das rotas
      pre-consentimento. O que nao pode e uma rota funcional ter ficado nele por
      esquecimento durante a conversao.
    */
    const aindaSimples = REQUIRES_TERMS_ROUTES.filter((route) =>
      /const auth = await getAuthenticatedUser\(\)/.test(sourceOf(route)),
    );
    expect(aindaSimples).toEqual([]);
  });
});

describe("a lista pre-consentimento nao cresce por conveniencia", () => {
  it("permanece minima e explicita", () => {
    /*
      Este numero e um freio deliberado. Toda entrada nova aqui e uma rota que
      funciona sem aceite dos termos, e a pergunta "por que esta precisa?" tem de
      ser respondida por quem a acrescenta — nao herdada em silencio.
    */
    expect(PRE_CONSENT_ALLOWED_ROUTES.length).toBeLessThanOrEqual(2);
    expect([...PRE_CONSENT_ALLOWED_ROUTES]).toEqual([
      "api/me/consents",
      "api/me/account",
    ]);
  });

  it("nao ha rota publica sob /api, e a ausencia e afirmada", () => {
    expect(PUBLIC_API_ROUTES).toEqual([]);
  });
});

describe("rotas de sistema (Stage 29-C)", () => {
  it("a lista interna e nominal e minima", () => {
    expect([...INTERNAL_SECRET_ROUTES]).toEqual(["api/internal/notifications/dispatch"]);
  });

  it("toda rota interna exige o segredo e nunca le sessao de pessoa", () => {
    for (const route of INTERNAL_SECRET_ROUTES) {
      const source = sourceOf(route);
      expect(source, route).toContain("requireInternalDispatchSecret");
      expect(source, route).not.toMatch(/getConsentedApiUser|getAuthenticatedUser|createClient\(/);
      expect(classifyApiRoute(route)).toBe("INTERNAL_SECRET");
    }
  });
});
