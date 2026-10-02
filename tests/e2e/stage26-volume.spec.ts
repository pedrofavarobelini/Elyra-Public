import { expect, test, type Page } from "@playwright/test";

import { loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";



const email = process.env.ELYRA_VOLUME_EMAIL;
const password = process.env.ELYRA_VOLUME_PASSWORD;
test.skip(!email || !password, "Medicao manual: exige conta de volume semeada.");
test.setTimeout(300_000);

const ROUTES = ["/dashboard", "/historico", "/diario", "/metas", "/ciclo", "/relatorios"] as const;

interface Sample {
  route: string;
  ms: number;
  documentBytes: number;
  totalBytes: number;
  requests: number;
}

async function measure(page: Page, route: string): Promise<Sample> {
  let documentBytes = 0;
  let totalBytes = 0;
  let requests = 0;
  const onResponse = async (response: import("@playwright/test").Response) => {
    requests += 1;
    const length = Number(response.headers()["content-length"] ?? 0);
    let size = length;
    if (!size) {
      size = await response
        .body()
        .then((body) => body.byteLength)
        .catch(() => 0);
    }
    totalBytes += size;
    const type = response.request().resourceType();
    if (type === "document" || type === "fetch" || type === "xhr") documentBytes += size;
  };
  page.on("response", onResponse);
  const started = Date.now();
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { level: 1 }).first().waitFor({ timeout: 120_000 });
  const ms = Date.now() - started;
  await page.waitForLoadState("load").catch(() => undefined);
  page.off("response", onResponse);
  return { route, ms, documentBytes, totalBytes, requests };
}

test("medicao de volume: tempo, payload e requisicoes por rota", async ({ browser, baseURL }) => {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await loginThroughUi(page, baseURL ?? "", { email: email!, password: password! });
    // Uma passada de aquecimento: interessa o custo em regime, nao o primeiro hit.
    await gotoHydrated(page, "/dashboard");

    const samples: Sample[] = [];
    for (const route of ROUTES) {
      const runs: Sample[] = [];
      for (let i = 0; i < 3; i += 1) runs.push(await measure(page, route));
      runs.sort((a, b) => a.ms - b.ms);
      samples.push(runs[1]!);
    }

    for (const sample of samples) {
      const line = `VOLUME ${sample.route} ms=${sample.ms} doc_kb=${(sample.documentBytes / 1024).toFixed(1)} total_kb=${(sample.totalBytes / 1024).toFixed(1)} requests=${sample.requests}`;
      test.info().annotations.push({ type: "volume", description: line });
      console.log(line);
    }
    expect(samples).toHaveLength(ROUTES.length);
  } finally {
    await context.close();
  }
});
