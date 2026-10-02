import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";

import { gotoHydrated } from "./hydrated";
import { qaAdmin } from "./professional-fixtures";

/**
 * SUP-2 — Rede de Apoio: lista + mapa com a fixture de QA (ADR-0032).
 *
 * Dado real continua desligado (ADR-0031): tudo roda sobre a fixture `[DEMO]`,
 * importada pelo importador de verdade e visivel so durante o teste.
 *
 * Tiles: o egress do QA nao alcanca o OpenFreeMap, entao `tiles.openfreemap.org`
 * e interceptado com um estilo local minimo. A CSP continua valendo: o
 * navegador recusaria o host antes da interceptacao se ele nao estivesse em
 * `connect-src`, e o spec falha em qualquer violacao de CSP.
 *
 * Nenhum `tel:` e clicado (so o href e conferido). Nenhuma coordenada da
 * pessoa pode aparecer em requisicao alguma.
 */

const USER_LAT = -23.5613;
const USER_LNG = -46.6565;
const SAO_PAULO = "São Paulo — SP";
const BLANK_STYLE = JSON.stringify({
  version: 8,
  sources: {},
  layers: [{ id: "fundo", type: "background", paint: { "background-color": "#e8eef3" } }],
});

const admin = qaAdmin();
let visibleBefore = false;
let activeBefore: string | null = null;

function importer(...args: string[]) {
  return execFileSync(process.execPath, ["scripts/import-support-network.mjs", ...args], { encoding: "utf8" });
}

function isoDaysAgo(days: number) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** Deixa ativo o snapshot de fixture da competencia pedida (importa se preciso). */
async function activateFixture(referenceDate: string) {
  const output = importer("--qa-fixture", "--reference-date", referenceDate, "--no-activate");
  const id = /(?:INACTIVE|NO_OP=IDEMPOTENT) snapshot=([0-9a-f-]{36})/.exec(output)?.[1];
  if (!id) throw new Error("fixture sem snapshot");
  const { data } = await admin.from("support_network_snapshots").select("status").eq("id", id).single();
  if (data?.status === "inactive") {
    const { error } = await admin.rpc("support_network_activate_snapshot", { p_snapshot_id: id, p_max_drop_ratio: 1 });
    if (error) throw error;
  } else if (data?.status === "superseded") {
    const { error } = await admin.rpc("support_network_rollback_snapshot", { p_snapshot_id: id });
    if (error) throw error;
  }
  return id;
}

async function setFixturesVisible(visible: boolean) {
  const { error } = await admin.from("support_network_settings").update({ fixtures_visible: visible }).eq("singleton", true);
  if (error) throw error;
}

/** Espiona geolocalizacao ANTES de qualquer script da pagina. */
async function spyGeolocation(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __geoCalls: number };
    w.__geoCalls = 0;
    const geo = navigator.geolocation;
    if (!geo) return;
    const original = geo.getCurrentPosition.bind(geo);
    geo.getCurrentPosition = (...args: Parameters<Geolocation["getCurrentPosition"]>) => {
      w.__geoCalls += 1;
      return original(...args);
    };
    geo.watchPosition = () => {
      w.__geoCalls += 1000;
      return 0;
    };
  });
}

type Probe = { requests: string[]; cspViolations: string[] };

async function preparePage(page: Page, tiles: "ok" | "fail" = "ok"): Promise<Probe> {
  const probe: Probe = { requests: [], cspViolations: [] };
  page.on("request", (request) => {
    probe.requests.push(`${request.method()} ${request.url()} ${request.postData() ?? ""}`);
  });
  page.on("console", (message) => {
    if (/Content Security Policy/i.test(message.text())) probe.cspViolations.push(message.text());
  });
  await page.route("https://tiles.openfreemap.org/**", (route) =>
    tiles === "fail"
      ? route.abort("failed")
      : route.request().url().includes("/styles/")
        ? route.fulfill({ status: 200, contentType: "application/json", body: BLANK_STYLE })
        : route.fulfill({ status: 404, body: "" }),
  );
  await spyGeolocation(page);
  return probe;
}

async function chooseSaoPaulo(page: Page) {
  const input = page.getByLabel("Município", { exact: true });
  await input.fill("sao pa");
  // Escopo da sugestao: a visao geral de entrada tambem lista "Sao Paulo".
  await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: new RegExp(`^${SAO_PAULO}`) }).click();
  await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(6);
}

async function openMapIfNeeded(page: Page) {
  const mapToggle = page.getByRole("group", { name: "Modo de exibição" }).getByRole("button", { name: "Mapa" });
  if (await mapToggle.isVisible()) await mapToggle.click();
}

function expectNoPersonalCoordinates(probe: Probe) {
  const leaked = probe.requests.filter((line) => line.includes(String(Math.abs(USER_LAT))) || line.includes(String(Math.abs(USER_LNG))));
  expect(leaked, "coordenada da pessoa nunca sai do navegador").toEqual([]);
}

async function expectAxeClean(page: Page, label: string) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).exclude(".maplibregl-canvas").analyze();
  expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`), label).toEqual([]);
}

test.describe("SUP-2 - Rede de Apoio (fixture de QA)", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeAll(async () => {
    const { data: settings } = await admin.from("support_network_settings").select("fixtures_visible").single();
    visibleBefore = settings?.fixtures_visible ?? false;
    const { data: active } = await admin
      .from("support_network_snapshots")
      .select("id")
      .eq("source", "qa_fixture")
      .eq("status", "active")
      .maybeSingle();
    activeBefore = active?.id ?? null;
    await activateFixture(isoDaysAgo(10));
    await setFixturesVisible(true);
  });

  test.afterAll(async () => {
    await setFixturesVisible(visibleBefore);
    if (activeBefore) {
      const { data } = await admin.from("support_network_snapshots").select("status").eq("id", activeBefore).single();
      if (data?.status === "superseded") await admin.rpc("support_network_rollback_snapshot", { p_snapshot_id: activeBefore });
    }
  });

  test("A+G: lista sem GPS, sem pedido de localizacao ao abrir, fixture anunciada como demonstracao", async ({ page }) => {
    const probe = await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await expect(page.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible();
    await expect(page.getByTestId("support-demo-banner")).toContainText("Ambiente de demonstração — unidades fictícias.");
    await expect(page.getByTestId("support-provenance")).toContainText("demonstração");
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
    // Lazy load: no tablet/celular nada do mapa (worker, estilo, tiles) antes do
    // toque em "Mapa". No computador o mapa de visao geral aparece na entrada

    const wide = await page.evaluate(() => window.matchMedia("(min-width: 80rem)").matches);
    if (!wide) expect(probe.requests.filter((line) => /vendor\/maplibre|openfreemap/.test(line))).toEqual([]);
    expectNoPersonalCoordinates(probe);

    await chooseSaoPaulo(page);
    await expect(page.getByTestId("support-announcement")).toContainText("6 serviços encontrados em São Paulo — SP");
    const list = page.getByTestId("support-list");
    await expect(list).not.toContainText("UBS desativada");
    await expect(list).not.toContainText("Ficticia Rio");
    await expect(list.getByRole("article").first()).toContainText("Tipo no cadastro:");
    // Filtro so com tipos que o dado sustenta; sem UBS/CAPS/UPA inventados.
    const filter = page.getByTestId("support-type-filter");
    await expect(filter.getByRole("button")).toHaveText([/Todos/, /CENTRO DE ATENCAO PSICOSSOCIAL/, /CENTRO DE SAUDE\/UNIDADE BASICA/, /PRONTO ATENDIMENTO/, /TIPO QA SEM MAPEAMENTO/]);
    await filter.getByRole("button", { name: /PRONTO ATENDIMENTO/ }).click();
    await expect(list.getByRole("article")).toHaveCount(1);
    await filter.getByRole("button", { name: /Todos/ }).click();
    await expect(list.getByRole("article")).toHaveCount(6);

    const search = probe.requests.filter((line) => line.startsWith("POST") && line.includes("/api/support/facilities/search"));
    expect(search.length).toBeGreaterThan(0);
    expect(search.every((line) => !/latitude|longitude/.test(line))).toBe(true);
    expect(probe.requests.some((line) => line.includes("/api/support") && line.includes("?"))).toBe(false);
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
    await expectAxeClean(page, "lista");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "sem rolagem lateral").toBeLessThanOrEqual(0);
  });

  test("B+C: mapa sob CSP real, pinos so da lista, lista <-> pino por teclado", async ({ page }) => {
    const probe = await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await chooseSaoPaulo(page);
    await openMapIfNeeded(page);
    const map = page.getByTestId("support-map");
    await expect(map).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    await expect(page.getByTestId("support-map-summary")).toContainText("4 de 6 unidades");
    const pins = page.locator(".elyra-support-pin");
    await expect(pins).toHaveCount(4);
    await expect(page.locator(".elyra-support-pin[data-cnes='9900006']")).toHaveCount(0);
    await expect(page.locator(".elyra-support-pin[data-cnes='9900003']")).toHaveCount(0);

    // Pino -> item: foco no nome do item e rotulo "Selecionada", nao so cor.
    const beta = page.locator(".elyra-support-pin[data-cnes='9900002']");
    await beta.focus();
    await page.keyboard.press("Enter");
    const betaCard = page.locator("article[data-cnes='9900002']");
    await expect(betaCard).toHaveAttribute("data-selected", "true");
    await expect(betaCard.getByText("Selecionada no mapa")).toBeVisible();
    await expect(betaCard.getByRole("button", { name: "[DEMO] UBS Ficticia Beta", exact: true })).toBeFocused();

    // Item -> pino.
    await page.getByRole("button", { name: "Ver [DEMO] UBS Ficticia Alfa no mapa" }).click();
    await expect(page.locator(".elyra-support-pin[data-cnes='9900001']")).toHaveAttribute("data-selected", "true");
    await expect(page.locator(".elyra-support-pin[data-cnes='9900002']")).toHaveAttribute("data-selected", "false");

    // Worker da propria origem; nenhuma violacao de CSP.
    expect(probe.requests.some((line) => line.includes("/vendor/maplibre/") && line.includes("maplibre-gl-worker.mjs"))).toBe(true);
    expect(probe.cspViolations).toEqual([]);
    await expectAxeClean(page, "mapa");
  });

  test("D: GPS so depois do toque; municipio e distancia calculados no aparelho; coordenada nunca enviada", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: USER_LAT, longitude: USER_LNG, accuracy: 50 });
    const probe = await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls), "sem pedido ao abrir").toBe(0);

    await page.getByTestId("support-use-location").click();
    await expect(page.getByTestId("support-location-status")).toHaveAttribute("data-location", "granted");
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(1);
    await expect(page.getByLabel("Município", { exact: true })).toHaveValue(SAO_PAULO);
    await expect(page.getByTestId("support-location-status")).toContainText("o município com dados mais perto de você");
    await expect(page.getByTestId("support-distance").first()).toContainText(/Aproximadamente/);
    // Mais perto primeiro: Beta (-23.561,-46.655) esta a ~0,2 km da posicao simulada.
    await expect(page.getByTestId("support-list").getByRole("article").first()).toContainText("UBS Ficticia Beta");
    expectNoPersonalCoordinates(probe);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href);
    expect(stored).not.toContain(String(Math.abs(USER_LAT)));
  });

  test("E: GPS negado — mensagem sem culpa, busca por municipio continua", async ({ page, context }) => {
    await context.clearPermissions();
    await preparePage(page);
    await page.addInitScript(() => {
      navigator.geolocation.getCurrentPosition = (_ok, fail) =>
        fail?.({ code: 1, message: "denied", PERMISSION_DENIED: 1, POSITION_UNAVAILABLE: 2, TIMEOUT: 3 } as GeolocationPositionError);
    });
    await gotoHydrated(page, "/rede-de-apoio");
    await page.getByTestId("support-use-location").click();
    await expect(page.getByTestId("support-location-status")).toContainText("Localização não autorizada. Você ainda pode buscar por município.");
    await chooseSaoPaulo(page);
  });

  test("F: mapa indisponivel (tiles falham) nao bloqueia a lista", async ({ page }) => {
    await preparePage(page, "fail");
    await gotoHydrated(page, "/rede-de-apoio");
    await chooseSaoPaulo(page);
    await openMapIfNeeded(page);
    await expect(page.getByTestId("support-map-failed")).toContainText("Não foi possível carregar o mapa. A lista continua disponível.", { timeout: 30_000 });
    const listToggle = page.getByRole("group", { name: "Modo de exibição" }).getByRole("button", { name: "Lista" });
    if (await listToggle.isVisible()) await listToggle.click();
    await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(6);
  });

  test("I+J: ligar e abrir rota so por toque, com href montado pela Elyra; detalhe acessivel", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await chooseSaoPaulo(page);
    const alfa = page.locator("article[data-cnes='9900001']");
    await expect(alfa.getByRole("link", { name: "Ligar para [DEMO] UBS Ficticia Alfa" })).toHaveAttribute("href", "tel:1100000001");
    await expect(page.locator("article[data-cnes='9900002']").getByRole("link", { name: /Ligar/ })).toHaveCount(0);
    const route = alfa.getByRole("link", { name: /Abrir rota/ });
    await expect(route).toHaveAttribute("target", "_blank");
    await expect(route).toHaveAttribute("rel", "noopener noreferrer");
    const href = new URL((await route.getAttribute("href"))!);
    expect(href.origin).toBe("https://www.google.com");
    expect(href.searchParams.get("destination")).toBe("-23.550000,-46.633000");
    expect(href.searchParams.has("origin")).toBe(false);

    await alfa.getByRole("button", { name: "Ver detalhes" }).click();
    const detail = page.getByRole("dialog", { name: "[DEMO] UBS Ficticia Alfa" });
    await expect(detail).toContainText("Ambiente de demonstração — unidades fictícias.");
    await expect(detail).toContainText("Confirme por telefone antes de ir.");
    await expect(detail).toContainText("Não é serviço de emergência. Em risco imediato, ligue 192.");
    await expect(detail).not.toContainText(/snapshot|sha256/i);
    await expectAxeClean(page, "detalhe");
  });

  test("L: sem rede, a ultima lista salva aparece com data e aviso; rota desabilitada", async ({ page, context }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await chooseSaoPaulo(page);
    await context.setOffline(true);
    try {
      await page.getByLabel("Município", { exact: true }).fill("sao pa");
      await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: new RegExp(`^${SAO_PAULO}`) }).click();
      await expect(page.getByTestId("support-offline-banner")).toContainText(/Sem conexão · lista salva em .* pode estar desatualizada/);
      await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(6);
      await expect(page.getByRole("link", { name: /Abrir rota/ })).toHaveCount(0);
      await expect(page.getByText("Abrir rota precisa de internet.").first()).toBeVisible();
      await expect(page.getByTestId("support-map")).toHaveCount(0);
    } finally {
      await context.setOffline(false);
    }
  });

  test("K: sem resultados com o backend real — texto honesto e contatos SOS", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    // Catalogo ja carregado; a fonte "some" antes da busca (fixture desligada no banco).
    await setFixturesVisible(false);
    try {
      await page.getByLabel("Município", { exact: true }).fill("sao pa");
      await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: new RegExp(`^${SAO_PAULO}`) }).click();
      const empty = page.getByTestId("support-empty");
      await expect(empty).toContainText("Nenhum serviço foi encontrado com os dados disponíveis.");
      await expect(empty).toContainText("A fonte pode estar incompleta.");
      await expect(page.getByText(/não existem serviços/i)).toHaveCount(0);

      await expect(empty.getByTestId("support-sos-pointer")).toHaveText("Em uma emergência ou risco imediato, use o botão SOS.");
      await expect(page.getByTestId("support-list-panel").getByRole("link", { name: /SAMU|CVV|Polícia/ })).toHaveCount(0);
    } finally {
      await setFixturesVisible(true);
    }
  });

  test("H: competencia antiga vira STALE com aviso, sem dizer que a unidade fechou", async ({ page }) => {
    const stale = await activateFixture(isoDaysAgo(200));
    try {
      await preparePage(page);
      await gotoHydrated(page, "/rede-de-apoio");
      const provenance = page.getByTestId("support-provenance");
      await expect(provenance).toHaveAttribute("data-freshness", "STALE");
      await expect(provenance).toContainText("Esta informação pode estar desatualizada");
      await expect(provenance).not.toContainText(/fechad|encerrad/i);
    } finally {
      await activateFixture(isoDaysAgo(10));
      await admin.from("support_network_snapshots").delete().eq("id", stale).neq("status", "active");
    }
  });

  test("SOS: painel continua estatico e so linka a Rede de Apoio", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/dashboard");
    const offOrigin: string[] = [];
    page.on("request", (request) => {
      if (request.method() !== "GET" || !request.url().startsWith(new URL(page.url()).origin)) offOrigin.push(request.url());
    });
    await page.getByRole("button", { name: "SOS: ajuda imediata" }).click();
    const dialog = page.getByRole("dialog", { name: "Precisa de ajuda agora?" });
    const link = dialog.getByRole("region", { name: "Rede de Apoio" }).getByRole("link", { name: "Abrir Rede de Apoio" });
    await expect(link).toHaveAttribute("href", "/rede-de-apoio");
    expect(offOrigin).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
    await link.click();
    await expect(page).toHaveURL(/\/rede-de-apoio$/);
    await expect(page.getByRole("heading", { name: "Rede de Apoio", level: 1 })).toBeVisible();
  });

  test("Y: lazy load — MapLibre fora do dashboard; na Rede so desce com o mapa visivel", async ({ page }) => {
    await preparePage(page);
    // Marcador de conteudo (independe do hash do chunk): string interna do MapLibre.
    const loaded: { phase: string; hasMapLibre: boolean; bytes: number }[] = [];
    let phase = "dashboard";
    page.on("response", async (response) => {
      if (!/\.m?js(\?|$)/.test(response.url())) return;
      const body = await response.body().catch(() => Buffer.alloc(0));
      loaded.push({ phase, hasMapLibre: body.includes("maplibregl-canvas"), bytes: body.length });
    });
    await gotoHydrated(page, "/dashboard");
    await page.waitForLoadState("networkidle");
    expect(loaded.some((item) => item.hasMapLibre), "MapLibre fora do dashboard").toBe(false);

    phase = "entrada";
    await gotoHydrated(page, "/rede-de-apoio");
    await page.waitForLoadState("networkidle");
    const wide = await page.evaluate(() => window.matchMedia("(min-width: 80rem)").matches);
    if (wide) {

      await expect(page.getByTestId("support-map")).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    } else {
      // Tablet/celular: lista primeiro; o MapLibre so desce ao tocar em "Mapa".
      expect(loaded.some((item) => item.phase === "entrada" && item.hasMapLibre), "MapLibre antes do toque").toBe(false);
      phase = "mapa";
      await openMapIfNeeded(page);
      await expect(page.getByTestId("support-map")).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    }
    await page.waitForLoadState("networkidle");
    expect(loaded.some((item) => item.phase !== "dashboard" && item.hasMapLibre), "MapLibre com o mapa visivel").toBe(true);
    const sum = (list: typeof loaded) => list.reduce((total, item) => total + item.bytes, 0);
    test.info().annotations.push({
      type: "bundle",
      description: `entrada=${sum(loaded.filter((i) => i.phase === "entrada"))}B mapa=${sum(loaded.filter((i) => i.phase === "mapa"))}B`,
    });
  });

  test("entrada: mapa de municipios + lista equivalente; escolher abre as unidades; sem GPS", async ({ page }, testInfo) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    const overview = page.getByTestId("support-overview");
    await expect(overview.getByRole("heading", { name: "Onde há unidades cadastradas" })).toBeVisible();
    await expect(page.getByText("Ambiente de demonstração — unidades fictícias.")).toBeVisible();
    const toggle = overview.getByRole("group", { name: "Modo de exibição" });
    if (testInfo.project.name === "desktop") {

      await expect(toggle).toBeHidden();
      await expect(overview.getByTestId("support-map")).toBeVisible();
    }
    const item = overview.getByTestId("support-overview-list").getByRole("button", { name: new RegExp(`^${SAO_PAULO} — `) });
    if (!(await item.isVisible())) await toggle.getByRole("button", { name: "Lista" }).click();
    await expect(item).toContainText("6 unidades");
    await expect(overview.getByTestId("support-overview-list").getByRole("button", { name: /^Orlândia — SP/ })).toContainText("3 unidades");
    await openMapIfNeeded(page);
    const map = overview.getByTestId("support-map");
    await expect(map).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    await expect(overview.getByTestId("support-map-summary")).toContainText("município");
    // Pinos de MUNICIPIO (botoes com nome), um por municipio da lista ao lado: RJ, SP e Orlandia.
    const pins = overview.locator("button.elyra-support-pin");
    await expect(pins).toHaveCount(3);
    // Nao basta o DOM existir: cada pino tem tamanho e esta DENTRO da area visivel do mapa.
    const mapBox = (await map.boundingBox())!;
    expect(mapBox.width, "mapa com largura real").toBeGreaterThan(200);
    expect(mapBox.height, "mapa com altura real").toBeGreaterThan(200);
    for (const pin of await pins.all()) {
      const box = (await pin.boundingBox())!;
      expect(box.width, "pino com tamanho").toBeGreaterThan(0);
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      expect(cx >= mapBox.x && cx <= mapBox.x + mapBox.width && cy >= mapBox.y && cy <= mapBox.y + mapBox.height, `pino ${await pin.getAttribute("aria-label")} dentro do mapa`).toBe(true);
    }
    await page.screenshot({ path: `test-results/support-network/${testInfo.project.name}-entrada.png`, fullPage: true });
    await expectAxeClean(page, "entrada com mapa");
    // Tocar no PINO (clique real do mouse no ponto) escolhe o municipio — mesmo caminho da busca.
    await overview.getByRole("button", { name: new RegExp(`^${SAO_PAULO} — 6 unidades \\(no mapa\\)`) }).click();
    await expect(page.getByLabel("Município", { exact: true })).toHaveValue(SAO_PAULO);
    // No celular/tablet a pessoa continua no "Mapa" (agora com as unidades); a lista esta a um toque.
    const modes = page.getByRole("group", { name: "Modo de exibição" });
    if (await modes.isVisible()) await modes.getByRole("button", { name: "Lista" }).click();
    await expect(page.getByTestId("support-list").getByRole("article")).toHaveCount(6);
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(0);
  });

  test("Orlandia [DEMO]: busca com e sem acento; pino da visao geral abre as unidades", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    const input = page.getByLabel("Município", { exact: true });
    const found = page.getByRole("list", { name: "Municípios encontrados" });
    for (const typed of ["Cidade Demo", "orlândia"]) {
      await input.fill(typed);
      await expect(found.getByRole("button", { name: /^Orlândia — SP/ }), typed).toBeVisible();
    }
    await found.getByRole("button", { name: /^Orlândia — SP/ }).click();
    const cards = page.getByTestId("support-list").getByRole("article");
    await expect(cards).toHaveCount(3);
    await expect(cards.first()).toContainText("[DEMO]");
    await expect(page.getByText("Ambiente de demonstração — unidades fictícias.")).toBeVisible();
    // Pelo pino da visao geral: volta para Sao Paulo e depois Orlandia de novo.
    await page.goto("/rede-de-apoio");
    await page.waitForSelector("html[data-hydrated='true']");
    await openMapIfNeeded(page);
    const overview = page.getByTestId("support-overview");
    await expect(overview.getByTestId("support-map")).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    await overview.getByRole("button", { name: /^Orlândia — SP — 3 unidades \(no mapa\)/ }).click();
    await expect(page.getByLabel("Município", { exact: true })).toHaveValue("Orlândia — SP");
    const modes = page.getByRole("group", { name: "Modo de exibição" });
    if (await modes.isVisible()) await modes.getByRole("button", { name: "Lista" }).click();
    await expect(cards).toHaveCount(3);
  });

  test("Orlandia [DEMO] + GPS: nenhum pedido ao abrir, um no toque, distancias no aparelho", async ({ page, context }) => {
    // Posicao simulada no centro de Orlandia; nunca pode sair do navegador.
    const lat = -20.7211;
    const lng = -47.8861;
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy: 50 });
    const probe = await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls), "sem pedido ao abrir").toBe(0);
    await page.getByTestId("support-use-location").click();
    await expect(page.getByTestId("support-location-status")).toHaveAttribute("data-location", "granted");
    expect(await page.evaluate(() => (window as unknown as { __geoCalls: number }).__geoCalls)).toBe(1);
    await expect(page.getByLabel("Município", { exact: true })).toHaveValue("Orlândia — SP");
    await expect(page.getByTestId("support-distance")).toHaveCount(3);
    await expect(page.getByTestId("support-distance").first()).toContainText(/Aproximadamente/);
    // Mais perto primeiro: a UBS Centro (-20.720,-47.887) fica a ~0,2 km.
    await expect(page.getByTestId("support-list").getByRole("article").first()).toContainText("UBS Ficticia Orlandia Centro");
    const leaked = probe.requests.filter((line) => line.includes("20.7211") || line.includes("47.8861"));
    expect(leaked, "coordenada da pessoa nunca sai do navegador").toEqual([]);
  });

  test("catalogo: ESTADO -> MUNICIPIO com contagens; filtro por texto (sem acento) e por UF; mapa segue o filtro", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    const overview = page.getByTestId("support-overview");
    const list = overview.getByTestId("support-overview-list");
    const toggle = overview.getByRole("group", { name: "Modo de exibição" });
    if (await toggle.isVisible()) await toggle.getByRole("button", { name: "Lista" }).click();
    const sp = list.getByRole("region", { name: "São Paulo — SP" });
    await expect(sp.getByRole("button", { name: /^São Paulo — SP/ }).first()).toContainText("2 municípios · 9 unidades");
    await expect(sp.getByRole("button", { name: /^Orlândia — SP — 3 unidades/ })).toBeVisible();
    await expect(sp.getByRole("button", { name: /^São Paulo — SP — 6 unidades/ })).toBeVisible();
    await expect(list.getByRole("region", { name: "Rio de Janeiro — RJ" })).toContainText("1 município · 1 unidade");
    // Grupo recolhe e abre pelo cabecalho (aria-expanded).
    const header = sp.getByRole("button", { name: /^São Paulo — SP 2 municípios/ });
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "false");
    await expect(sp.getByRole("button", { name: /^Orlândia/ })).toHaveCount(0);
    await header.click();
    await expect(header).toHaveAttribute("aria-expanded", "true");

    const filters = overview.getByTestId("support-catalog-filters");
    for (const typed of ["ORLANDIA", "orlândia"]) {
      await filters.getByLabel("Filtrar municípios").fill(typed);
      await expect(list.getByTestId("support-catalog-state")).toHaveCount(1);
      await expect(list.getByRole("button", { name: /^Orlândia — SP — 3 unidades/ })).toBeVisible();
      await expect(list.getByRole("button", { name: /^São Paulo — SP — 6/ })).toHaveCount(0);
    }
    await filters.getByLabel("Filtrar municípios").fill("");
    await filters.getByLabel("Estado").selectOption("RJ");
    await expect(list.getByTestId("support-catalog-state")).toHaveCount(1);
    await expect(list).toContainText("Rio de Janeiro — RJ");
    await openMapIfNeeded(page);
    await expect(overview.getByTestId("support-map")).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    await expect(overview.locator("button.elyra-support-pin")).toHaveCount(1);
    await expect(overview.getByTestId("support-map-summary")).toContainText("com o filtro atual");
    if (await toggle.isVisible()) await toggle.getByRole("button", { name: "Lista" }).click();
    await filters.getByLabel("Filtrar municípios").fill("xyz");
    await expect(list.getByTestId("support-catalog-empty")).toBeVisible();
    await expectAxeClean(page, "catalogo filtrado");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "sem rolagem lateral").toBeLessThanOrEqual(0);
  });

  test("falha da busca mostra o codigo (diagnostico do QA) e nao repete os contatos do SOS", async ({ page }) => {
    await preparePage(page);
    await page.route("**/api/support/facilities/search", (route) => route.fulfill({ status: 503, contentType: "application/json", body: "{}" }));
    await gotoHydrated(page, "/rede-de-apoio");
    await page.getByLabel("Município", { exact: true }).fill("orlandia");
    await page.getByRole("list", { name: "Municípios encontrados" }).getByRole("button", { name: /^Orlândia — SP/ }).click();
    const modes = page.getByRole("group", { name: "Modo de exibição" });
    if (await modes.isVisible()) await modes.getByRole("button", { name: "Lista" }).click();
    const panel = page.getByTestId("support-list-panel");
    await expect(panel).toContainText("Não foi possível carregar a lista agora");
    await expect(panel).toContainText("(código: 503)");
    await expect(panel.getByTestId("support-sos-pointer")).toBeVisible();
    await expect(panel.getByRole("link", { name: /SAMU|CVV|Polícia/ })).toHaveCount(0);
  });

  test("SOS no canto inferior direito na Rede de Apoio (topo, meio e fim), sem ir para a esquerda nem subir demais", async ({ page }) => {
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    for (const y of [0, Math.floor(height / 2), height]) {
      await page.evaluate((top) => window.scrollTo(0, top), y);
      const box = await page
        .waitForFunction(() => {
          const fab = document.querySelector<HTMLElement>("[data-elyra-sos]");
          if (!fab || fab.hasAttribute("data-sos-concealed")) return null;
          const r = fab.getBoundingClientRect();
          return { left: r.left, right: r.right, bottom: r.bottom, vw: window.innerWidth, vh: window.innerHeight, side: fab.dataset.sosSide };
        }, undefined, { timeout: 3000 })
        .then((handle) => handle.jsonValue());
      if (!box) throw new Error(`SOS oculto @${y}`);
      expect(box.side, `lado @${y}`).toBe("right");
      expect(box.right, `encostado a direita @${y}`).toBeGreaterThan(box.vw - 40);
      expect(box.left, `nunca no centro/esquerda @${y}`).toBeGreaterThan(box.vw / 2);
      // Base + degrau maximo (48 px) + margem: nunca "atravessa" a tela.
      expect(box.vh - box.bottom, `perto da base @${y}`).toBeLessThanOrEqual(24 + 48 + 12);
      expect(box.bottom).toBeLessThanOrEqual(box.vh);
    }
  });

  test("T: tema escuro do sistema — lista, mapa e detalhe sem violacao de axe", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await preparePage(page);
    await gotoHydrated(page, "/rede-de-apoio");
    // Tema "sistema": o atributo fica "system" e o escuro vem da media query.
    await expect(page.locator("html")).toHaveAttribute("data-elyra-theme", "system");
    const surface = await page.evaluate(() => ({
      dark: window.matchMedia("(prefers-color-scheme: dark)").matches,
      bg: getComputedStyle(document.body).backgroundColor,
    }));
    expect(surface.dark).toBe(true);
    const [r, g, b] = (surface.bg.match(/\d+/g) ?? ["255", "255", "255"]).map(Number);
    expect((r! + g! + b!) / 3, `fundo escuro de fato (${surface.bg})`).toBeLessThan(80);
    await chooseSaoPaulo(page);
    await expectAxeClean(page, "lista escura");
    await openMapIfNeeded(page);
    await expect(page.getByTestId("support-map")).toHaveAttribute("data-map-status", "ready", { timeout: 30_000 });
    await expectAxeClean(page, "mapa escuro");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "sem rolagem lateral").toBeLessThanOrEqual(0);
  });
});
