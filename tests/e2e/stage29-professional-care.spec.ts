import { createClient } from "@supabase/supabase-js";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser } from "../qa-cleanup";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";



interface QaIdentity {
  project: string;
  email: string;
  password: string;
  userId: string;
}

function localAdmin() {
  process.loadEnvFile?.(".env.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) throw new Error("Playwright QA local nao configurado.");
  return createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function projectProfessional(projectName: string) {
  const identities = JSON.parse(
    readFileSync(resolve(process.cwd(), "test-results", ".auth", "identity.json"), "utf8"),
  ) as QaIdentity[];
  const professional = identities.find((candidate) => candidate.project === projectName);
  if (!professional) throw new Error("Profissional QA ausente.");
  return professional;
}

async function redeem(request: APIRequestContext, token: string, action: string) {
  const response = await request.post("/api/professional/invites/redeem", {
    data: { token, action },
  });
  return { status: response.status(), body: await response.text() };
}

test.describe("Stage 29 - convite profissional", () => {
  test("convite gerado pelo profissional vira vinculo sem nenhum dado compartilhado", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    const admin = localAdmin();
    const professional = projectProfessional(testInfo.project.name);
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
    const person = {
      email: `playwright-patient-${testInfo.project.name}-${run}@elyra.invalid`,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}6`,
    };
    const personId = await createConfirmedQaUser(admin, {
      ...person,
      displayName: "Pessoa Convite QA",
    });

    try {
      // 1. Profissional gera o convite na interface.
      await gotoHydrated(page, "/pro/solicitacoes");
      await page.getByRole("button", { name: "Gerar convite" }).click();
      const created = page.getByTestId("invite-created");
      await expect(created).toBeVisible();
      const token = (await created.getByTestId("invite-code").textContent())?.trim() ?? "";
      expect(token).toMatch(/^ELY-[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);

      // 2. A pessoa abre o link com o token no fragmento.
      const context = await browser.newContext();
      const personPage = await context.newPage();
      try {
        await loginThroughUi(personPage, baseURL, person);
        const requests: string[] = [];
        personPage.on("request", (request) => requests.push(request.url()));
        await personPage.goto(`${baseURL}/convite#${token}`);
        await personPage.waitForSelector("html[data-hydrated='true']");
        await expect(personPage.getByRole("heading", { name: "Demo" })).toBeVisible();
        // O token sai da barra de endereco assim que lido e nunca vai em URL.
        expect(personPage.url()).not.toContain(token);
        expect(requests.some((url) => url.includes(token))).toBe(false);

        await personPage.getByRole("button", { name: "Aceitar convite" }).click();
        await expect(personPage.getByRole("status")).toHaveText(
          /^Você está conectado com .+\. Nada foi compartilhado\.$/,
        );

        // 3. Vinculo ativo, zero grants.
        const connections = await personPage.request.get("/api/professional/connections");
        const rows = ((await connections.json()) as {
          data: Array<{ id: string; professional_user_id: string; status: string }>;
        }).data.filter((row) => row.professional_user_id === professional.userId);
        expect(rows).toHaveLength(1);
        const permissions = await personPage.request.get(
          `/api/professional/permissions?connectionId=${rows[0]!.id}`,
        );
        expect(((await permissions.json()) as { data: unknown[] }).data).toEqual([]);

        // 4. L-435: o proprio titular repetindo o aceite recebe o mesmo vinculo.
        //    Codigos errados recebem exatamente a mesma resposta entre si.
        const replay = await redeem(personPage.request, token, "accept");
        expect(replay.status).toBe(200);
        expect(JSON.parse(replay.body).data).toMatchObject({ outcome: "already_accepted", relationshipId: rows[0]!.id });
        const flipped = `${token.slice(0, 14)}${token.endsWith("A") ? "B" : "A"}`;
        const wrong = await redeem(personPage.request, flipped, "preview");
        const other = await redeem(personPage.request, "ELY-00000-00000", "accept");
        expect(wrong.status).toBe(404);
        expect(other.status).toBe(404);
        expect(wrong.body).toBe(other.body);
        expect(wrong.body).not.toContain(professional.userId);
      } finally {
        await context.close();
      }

      // 5. Sem sessao, nada.
      const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      try {
        const denied = await redeem(anonymous.request, token, "preview");
        expect(denied.status).toBe(401);
      } finally {
        await anonymous.close();
      }
    } finally {
      await cleanupQaUser(admin, personId);
    }
  });

  test("convite revogado nao abre, e o codigo nunca volta a ser exibido", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    const admin = localAdmin();
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
    const person = {
      email: `playwright-patient-${testInfo.project.name}-${run}@elyra.invalid`,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}5`,
    };
    const personId = await createConfirmedQaUser(admin, {
      ...person,
      displayName: "Pessoa Revogada QA",
    });

    try {
      await gotoHydrated(page, "/pro/solicitacoes");
      const createdResponse = await page.request.post("/api/professional/invites");
      expect(createdResponse.status()).toBe(201);
      expect(createdResponse.headers()["cache-control"]).toContain("no-store");
      const created = (await createdResponse.json()) as {
        data: { inviteId: string; token: string };
      };

      const listed = await page.request.get("/api/professional/invites");
      const listedBody = await listed.text();
      expect(listedBody).toContain(created.data.inviteId);
      expect(listedBody).not.toContain(created.data.token);

      const revoked = await page.request.delete(
        `/api/professional/invites?id=${created.data.inviteId}`,
      );
      expect(revoked.status()).toBe(200);

      const context = await browser.newContext();
      const personPage = await context.newPage();
      try {
        await loginThroughUi(personPage, baseURL, person);
        await personPage.goto(`${baseURL}/convite#${created.data.token}`);
        await personPage.waitForSelector("html[data-hydrated='true']");
        await expect(
          personPage.getByRole("alert").filter({ hasText: "Este código não está disponível" }),
        ).toBeVisible();
        await expect(personPage.getByLabel("Código")).toBeVisible();
      } finally {
        await context.close();
      }
    } finally {
      await cleanupQaUser(admin, personId);
    }
  });

  test("grant, pausa e revogacao valem na consulta seguinte, e so o titular governa", async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    if (!baseURL) throw new Error("baseURL ausente.");
    const admin = localAdmin();
    const professional = projectProfessional(testInfo.project.name);
    const run = crypto.randomUUID().replaceAll("-", "").slice(0, 14);
    const person = {
      email: `playwright-patient-${testInfo.project.name}-${run}@elyra.invalid`,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}4`,
    };
    const personId = await createConfirmedQaUser(admin, {
      ...person,
      displayName: "Pessoa Grant QA",
    });
    const { error: checkinError } = await admin.from("emotional_checkins").insert({
      user_id: personId,
      occurred_at: new Date().toISOString(),
      mood_score: 7,
    });
    if (checkinError) throw checkinError;

    const dossier = async () => {
      const response = await page.request.get(`/api/professional/patients/${personId}`);
      const body = (await response.json()) as {
        data?: { data: { emotional: unknown[] } };
      };
      return { status: response.status(), emotional: body.data?.data.emotional.length ?? null };
    };

    try {
      await gotoHydrated(page, "/pro/solicitacoes");
      const created = (await (await page.request.post("/api/professional/invites")).json()) as {
        data: { token: string };
      };

      const context = await browser.newContext();
      const personPage = await context.newPage();
      try {
        await loginThroughUi(personPage, baseURL, person);
        const accepted = await redeem(personPage.request, created.data.token, "accept");
        expect(accepted.status).toBe(200);
        const connectionId = (JSON.parse(accepted.body) as { data: { relationshipId: string } })
          .data.relationshipId;

        // Vinculo ativo sem grant: o dossie abre e vem vazio.
        expect(await dossier()).toEqual({ status: 200, emotional: 0 });

        // O profissional nao concede nada a si mesmo.
        const selfGrant = await page.request.put("/api/professional/permissions", {
          data: { connectionId, scope: "emotional", enabled: true },
        });
        expect(selfGrant.status()).toBe(403);

        // O titular concede: a consulta seguinte ja ve.
        const grant = await personPage.request.put("/api/professional/permissions", {
          data: { connectionId, scope: "emotional", enabled: true },
        });
        expect(grant.status()).toBe(200);
        expect(await dossier()).toEqual({ status: 200, emotional: 1 });

        // Pausa pelo titular: nega tudo, sem perder o grant.
        await gotoHydrated(personPage, "/configuracoes/privacidade");
        await personPage.getByRole("button", { name: "Pausar" }).click();
        await expect(personPage.getByText("Pausado por você")).toBeVisible();
        const paused = await dossier();
        expect(paused.status).toBe(403);
        expect(paused.emotional).toBeNull();

        // O profissional nao retoma a pausa do titular.
        const forcedResume = await page.request.patch("/api/professional/connections", {
          data: { connectionId, action: "resume" },
        });
        expect(forcedResume.status()).toBe(403);

        await personPage.getByRole("button", { name: "Retomar" }).click();
        await expect(personPage.getByText("Ativo", { exact: true })).toBeVisible();
        expect(await dossier()).toEqual({ status: 200, emotional: 1 });

        // Revogar o grant: efeito na consulta seguinte.
        const revoke = await personPage.request.put("/api/professional/permissions", {
          data: { connectionId, scope: "emotional", enabled: false },
        });
        expect(revoke.status()).toBe(200);
        expect(await dossier()).toEqual({ status: 200, emotional: 0 });

        // A trilha do titular mostra o ciclo de vida, sem conteudo.
        const trail = (await (await personPage.request.get("/api/professional/access-log")).json()) as {
          data: Array<{ event_type: string; connection_id: string }>;
        };
        const events = trail.data
          .filter((row) => row.connection_id === connectionId)
          .map((row) => row.event_type);
        for (const expected of [
          "relationship_created",
          "grant_created",
          "relationship_paused",
          "relationship_resumed",
          "grant_revoked",
          "resource_viewed",
        ]) {
          expect(events).toContain(expected);
        }
        expect(JSON.stringify(trail)).not.toContain("mood_score");

        // O profissional nao le a trilha de quem ele acompanha.
        const proTrail = (await (await page.request.get("/api/professional/access-log")).json()) as {
          data: Array<{ connection_id: string }>;
        };
        expect(proTrail.data.some((row) => row.connection_id === connectionId)).toBe(false);

        // Encerramento pelo titular fecha o dossie.
        const ended = await personPage.request.patch("/api/professional/connections", {
          data: { connectionId, action: "revoke" },
        });
        expect(ended.status()).toBe(200);
        expect((await dossier()).status).toBe(403);
      } finally {
        await context.close();
      }

      // IDOR e ids malformados.
      const unrelated = await page.request.get(
        "/api/professional/patients/00000000-0000-4000-8000-000000000000",
      );
      expect(unrelated.status()).toBe(403);
      const malformed = await page.request.get("/api/professional/patients/nao-e-uuid");
      expect(malformed.status()).toBe(400);
      // Corpo que nao e JSON e pedido invalido, nunca erro interno.
      const notJson = await page.request.post("/api/professional/invites/redeem", {
        headers: { "content-type": "application/json" },
        data: "{nao-e-json",
      });
      expect(notJson.status()).toBe(400);
      // Payload fora do contrato (campo extra) tambem e 400.
      const extraField = await page.request.post("/api/professional/invites/redeem", {
        data: { token: "A".repeat(43), action: "accept", scope: "emotional" },
      });
      expect(extraField.status()).toBe(400);
      expect(professional.userId).not.toBe(personId);
    } finally {
      await cleanupQaUser(admin, personId);
    }
  });
});
