import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import { createHmac } from "node:crypto";

import type { Database } from "@/lib/supabase/database.types";
import { cleanupQaUser } from "../qa-cleanup";
import { createConfirmedQaUser, loginThroughUi } from "../qa-identity";
import { gotoHydrated } from "./hydrated";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function totp(secret: string, at: number = Date.now()): string {
  let bits = "";
  for (const char of secret.replace(/=+$/, "").toUpperCase()) {
    const index = BASE32.indexOf(char);
    if (index >= 0) bits += index.toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => parseInt(byte, 2)));
  const counter = Math.floor(at / 1000 / 30);
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 2 ** 32), 0);
  message.writeUInt32BE(counter % 2 ** 32, 4);
  const digest = createHmac("sha1", bytes).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const code =
    ((digest[offset]! & 0x7f) << 24) |
    (digest[offset + 1]! << 16) |
    (digest[offset + 2]! << 8) |
    digest[offset + 3]!;
  return String(code % 1_000_000).padStart(6, "0");
}

function authCookies(cookies: Awaited<ReturnType<import("@playwright/test").BrowserContext["cookies"]>>) {
  return cookies.filter((cookie) => cookie.name.includes("auth-token"));
}

test.describe("Stage 28-R — Passkeys reais via WebAuthn", () => {
  test("registra, autentica, preserva fallback e remove a credencial", async ({
    browser,
    baseURL,
  }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "WebAuthn virtual e validado uma vez no Chromium desktop.");

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !serviceRoleKey) throw new Error("Admin local ausente para provar ownership da Passkey.");
    const admin = createClient<Database>(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        experimental: { passkey: true },
      },
    });
    const listFor = async (userId: string) => {
      const result = await admin.auth.admin.passkey.listPasskeys({ userId });
      if (result.error || !result.data) throw result.error ?? new Error("Lista de Passkeys ausente.");
      return result.data;
    };
    /*
      L-267: o spec tem identidades proprias. Antes ele abria a sessao
      compartilhada do QA (`test-results/.auth/desktop.json`) e clicava "Sair";
      o logout revogava aquela sessao no servidor e todo spec desktop posterior
      caia em /entrar. Agora cria duas contas sinteticas, entra pela tela real
      num contexto vazio e apaga as duas no fim (passkey, fator TOTP e App Lock
      vao junto), sem depender da ordem dos specs.
    */
    const newIdentity = (label: string, displayName: string) => ({
      email: `playwright-${label}-${crypto.randomUUID().replaceAll("-", "").slice(0, 14)}@elyra.invalid`,
      password: `Qa${crypto.randomUUID().replaceAll("-", "")}3`,
      displayName,
      userId: "",
    });
    const identity = newIdentity("desktop", "Demo Passkey QA");
    const otherIdentity = newIdentity("patient-desktop", "Outra Pessoa QA");

    try {
      identity.userId = await createConfirmedQaUser(admin, identity);
      otherIdentity.userId = await createConfirmedQaUser(admin, otherIdentity);

      const ownerBefore = await listFor(identity.userId);
      const otherBefore = await listFor(otherIdentity.userId);
      expect(ownerBefore).toHaveLength(0);

      const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
      const page = await context.newPage();
      const cdp = await context.newCDPSession(page);
      await cdp.send("WebAuthn.enable");
      const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "internal",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });

      try {
        await loginThroughUi(page, baseURL!, identity);
        await gotoHydrated(page, `${baseURL}/seguranca`);
        await expect(page.getByText(`${identity.email}`, { exact: false })).toBeVisible();
        await page.getByRole("button", { name: "Cadastrar nova chave" }).click();
        const confirmation = page.getByRole("dialog", { name: "Confirmar conta da chave" });
        await expect(confirmation).toContainText(identity.email);
        await confirmation.getByRole("button", { name: "Cadastrar para esta conta" }).click();
        await expect(page.getByRole("status")).toContainText("Chave de acesso cadastrada");
        await expect(page.getByText("Passkey", { exact: true })).toBeVisible();

        const ownerAfter = await listFor(identity.userId);
        const otherAfter = await listFor(otherIdentity.userId);
        expect(ownerAfter).toHaveLength(ownerBefore.length + 1);
        expect(otherAfter).toHaveLength(otherBefore.length);

        // A Passkey autentica a conta, mas não inventa AAL2: TOTP continua sendo
        // o segundo fator que o backend exige para esta identidade.
        const mfaCard = page.getByRole("heading", { name: "Verificação em duas etapas" })
          .locator("xpath=ancestor::*[contains(@class,'rounded-card')][1]");
        await mfaCard.getByRole("button", { name: "Ativar verificação em duas etapas" }).click();
        const secretNode = mfaCard.locator("p.font-mono");
        await expect(secretNode).toBeVisible({ timeout: 30_000 });
        const mfaSecret = ((await secretNode.textContent()) ?? "").trim();
        await mfaCard.getByLabel("Código gerado pelo aplicativo").fill(totp(mfaSecret));
        await mfaCard.getByRole("button", { name: "Confirmar e ativar" }).click();
        await expect(mfaCard).toContainText("Ativa", { timeout: 30_000 });

        await page.getByRole("button", { name: "Sair", exact: true }).click();
        await expect(page).toHaveURL(/\/entrar$/);
        expect(authCookies(await context.cookies())).toHaveLength(0);

        // Uma sessão de outra pessoa não pode contaminar o usuário resolvido pela chave.
        await page.getByLabel("E-mail").fill(otherIdentity.email);
        await page.getByLabel("Senha", { exact: true }).fill(otherIdentity.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
        await gotoHydrated(page, `${baseURL}/perfil`);
        await expect(page.getByLabel("E-mail")).toHaveValue(otherIdentity.email);
        await page.getByRole("button", { name: "Sair", exact: true }).click();
        await expect(page).toHaveURL(/\/entrar$/);
        expect(authCookies(await context.cookies())).toHaveLength(0);

        await page.getByRole("button", { name: "Entrar com chave de acesso" }).click();
        await expect(page).toHaveURL(/\/entrar\/verificacao$/);
        await page.getByLabel("Código do aplicativo").fill(totp(mfaSecret));
        await page.getByRole("button", { name: "Confirmar e entrar" }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.getByRole("heading", { name: `Olá, ${identity.displayName}` })).toBeVisible();
        await gotoHydrated(page, `${baseURL}/perfil`);
        await expect(page.getByLabel("E-mail")).toHaveValue(identity.email);

        const sessionCookies = authCookies(await context.cookies());
        expect(sessionCookies.length).toBeGreaterThan(0);
        expect(sessionCookies.every((cookie) => cookie.httpOnly)).toBe(true);
        expect(await page.evaluate(() => document.cookie.includes("auth-token"))).toBe(false);

        // AAL2 e App Lock são gates independentes. Mesmo depois do TOTP, bloquear
        // a sessão fecha páginas e APIs; o PIN apenas reabre a sessão já AAL2.
        const appLockPin = "731905";
        await gotoHydrated(page, `${baseURL}/seguranca`);
        await page.getByRole("button", { name: "Ativar App Lock" }).click();
        const appLockCreate = page.getByRole("dialog", { name: "Criar PIN da Elyra" });
        await appLockCreate.getByLabel("Novo PIN").fill(appLockPin);
        await appLockCreate.getByLabel("Confirmar PIN").fill(appLockPin);
        await appLockCreate.getByRole("button", { name: "Ativar", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("App Lock ativado");
        await page.getByRole("button", { name: "Bloquear agora" }).click();
        await expect(page.getByRole("heading", { name: "Elyra bloqueada" })).toBeVisible();
        const lockedApi = await page.request.get("/api/me/export");
        expect(lockedApi.status()).toBe(423);
        await page.getByLabel("PIN da Elyra").fill(appLockPin);
        await page.getByRole("button", { name: "Desbloquear", exact: true }).click();
        await expect(page).toHaveURL(/\/dashboard$/);
        await gotoHydrated(page, `${baseURL}/seguranca`);
        await page.getByRole("button", { name: "Remover App Lock" }).click();
        const appLockRemoval = page.getByRole("dialog", { name: "Remover App Lock" });
        await appLockRemoval.getByLabel("PIN atual").fill(appLockPin);
        await appLockRemoval.getByRole("button", { name: "Remover", exact: true }).click();
        await expect(page.getByRole("status")).toContainText("App Lock removido");

        // Fallback continua real depois de registrar a chave.
        await page.getByRole("button", { name: "Sair", exact: true }).click();
        await page.getByLabel("E-mail").fill(identity.email);
        await page.getByLabel("Senha", { exact: true }).fill(identity.password);
        await page.getByRole("button", { name: "Entrar", exact: true }).click();
        await expect(page).toHaveURL(/\/entrar\/verificacao$/);
        await page.getByLabel("Código do aplicativo").fill(totp(mfaSecret));
        await page.getByRole("button", { name: "Confirmar e entrar" }).click();
        await expect(page).toHaveURL(/\/dashboard$/);

        await gotoHydrated(page, `${baseURL}/seguranca`);
        await page.getByRole("button", { name: "Remover Passkey" }).click();
        await expect(page.getByRole("status")).toContainText("Chave removida");
        await expect(listFor(identity.userId)).resolves.toHaveLength(ownerBefore.length);

        await mfaCard.getByRole("button", { name: "Desativar" }).click();
        await mfaCard.getByLabel("Código atual para confirmar").fill(totp(mfaSecret));
        await mfaCard.getByRole("button", { name: "Confirmar e desativar" }).click();
        await expect(mfaCard).toContainText("Não ativa", { timeout: 30_000 });

        await page.getByRole("button", { name: "Sair", exact: true }).click();
        await page.getByRole("button", { name: "Entrar com chave de acesso" }).click();
        await expect(page.getByRole("status")).toContainText(/não foi encontrada|não pôde ser verificada|Nenhum autenticador|cancelada/i);
      } finally {
        await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId }).catch(() => {});
        await cdp.send("WebAuthn.disable").catch(() => {});
        await context.close();
      }
    } finally {
      const created = [identity.userId, otherIdentity.userId].filter(Boolean);
      if (created.length > 0) {
        await admin.from("app_lock_sessions").delete().in("user_id", created);
        for (const userId of created) await cleanupQaUser(admin as never, userId);
      }
    }

    // Prova de isolamento: a sessao compartilhada do QA desktop sobrevive ao spec.
    const shared = await browser.newContext({ storageState: "test-results/.auth/desktop.json" });
    try {
      const sharedPage = await shared.newPage();
      await gotoHydrated(sharedPage, `${baseURL}/dashboard`);
      await expect(sharedPage).toHaveURL(/\/dashboard$/);
    } finally {
      await shared.close();
    }
  });
});
