import { expect, test } from "@playwright/test";
import { gotoHydrated } from "./hydrated";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "@/lib/supabase/database.types";

interface QaIdentity {
  project: string;
  userId: string;
}

test("Stage 08 calcula live report real e exporta snapshot imutavel", async ({
  baseURL,
  browser,
  page,
}, testInfo) => {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey || !baseURL) {
    throw new Error("QA local Stage 08 nao configurado.");
  }

  const identities = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "test-results", ".auth", "identity.json"),
      "utf8",
    ),
  ) as QaIdentity[];
  const userId = identities.find(
    (identity) => identity.project === testInfo.project.name,
  )?.userId;
  if (!userId) throw new Error("Identidade QA Stage 08 nao encontrada.");

  const admin = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await gotoHydrated(page, "/relatorios");
  await expect(
    page.getByRole("heading", { name: "Relatórios e evolução", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Sessões" })).toBeDisabled();
  await expect(
    page.getByRole("group", { name: "Humor médio" }),
  ).not.toContainText("Sem registro");


  const salvar = page.getByRole("button", { name: "Salvar relatório" });
  await expect(salvar).toBeEnabled();

  const [download] = await Promise.all([
    page.waitForEvent("download"),
    salvar.click(),
  ]);
  await expect(page.getByRole("status")).toHaveText(
    "Relatório exportado e snapshot imutável salvo.",
  );
  expect(download.suggestedFilename()).toMatch(
    /^elyra-relatorio-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.json$/,
  );

  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8")) as {
    schemaVersion: string;
    analyticsVersion: string;
    cycleHeuristicVersion: string;
    series: unknown[];
    dataQuality: { daysInWindow: number };
  };
  expect(payload.schemaVersion).toBe("report_snapshot/v1");
  expect(payload.analyticsVersion).toBe("elyra-analytics/v1");
  expect(payload.cycleHeuristicVersion).toBe("elyra-cycle/v1");
  expect(payload.series).toHaveLength(28);
  expect(payload.dataQuality.daysInWindow).toBe(28);
  expect(JSON.stringify(payload)).not.toMatch(/"note"|"journal"|"sessions"/i);

  const { data: rows, error } = await admin
    .from("report_snapshots")
    .select("schema_version, analytics_version, payload")
    .eq("user_id", userId);
  expect(error).toBeNull();
  expect(rows).toHaveLength(1);
  expect(rows?.[0]?.schema_version).toBe("report_snapshot/v1");
  expect(rows?.[0]?.analytics_version).toBe("elyra-analytics/v1");
  expect(rows?.[0]?.payload).toEqual(payload);

  const anonymous = await browser.newContext({
    storageState: { cookies: [], origins: [] },
  });
  try {
    const response = await anonymous.request.post(`${baseURL}/api/reports/snapshots`, {
      data: {
        days: 28,
        referenceDate: "2026-08-25",
        timeZone: "America/Sao_Paulo",
      },
    });
    expect(response.status()).toBe(401);
  } finally {
    await anonymous.close();
  }
});
