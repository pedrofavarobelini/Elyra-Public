import type { Page } from "@playwright/test";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CURRENT_TERMS_PRIVACY_VERSION,
  TERMS_PRIVACY_PURPOSE,
} from "@/lib/contracts/consent";
import type { Database } from "@/lib/supabase/database.types";
import { assertNotQaCanonicalAccount } from "./qa-canonical-account";


export async function createConfirmedQaUser(
  admin: SupabaseClient<Database>,
  input: { email: string; password: string; displayName: string },
): Promise<string> {
  assertNotQaCanonicalAccount(input.email);
  const target = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://invalid");
  if (!input.email.endsWith("@elyra.invalid") ||
      !["127.0.0.1", "localhost"].includes(target.hostname) || target.port !== "54381") {
    throw new Error("Fixture recusada fora da identidade sintetica e do alvo QA local.");
  }
  const { data, error } = await admin.auth.admin.createUser({
    email: input.email,
    password: input.password,
    email_confirm: true,
    user_metadata: { display_name: input.displayName },
  });
  if (error || !data.user) {
    throw error ?? new Error(`Identidade QA nao criada: ${input.email}`);
  }

  const { error: consentError } = await admin.from("consent_events").insert({
    user_id: data.user.id,
    purpose: TERMS_PRIVACY_PURPOSE,
    document_version: CURRENT_TERMS_PRIVACY_VERSION,
    event_type: "granted",
  });
  if (consentError) {

    const cleanup = await admin.auth.admin.deleteUser(data.user.id);
    if (cleanup.error) throw new Error("Falha no consentimento e no cleanup da fixture QA.");
    throw consentError;
  }

  return data.user.id;
}

/**
 * Entra pela tela real de login.
 *
 * A sessao precisa nascer no navegador para virar `storageState`, e o login por
 * senha e o caminho que o produto oferece. A espera pela hidratacao existe pelo
 * mesmo motivo de sempre (`L-046`): sem ela o preenchimento cai no HTML ainda
 * inerte e o setup inteiro morre no primeiro passo.
 */
export async function loginThroughUi(
  page: Page,
  baseURL: string,
  credentials: { email: string; password: string },
): Promise<void> {
  await page.goto(`${baseURL}/entrar`);
  await page.waitForSelector("html[data-hydrated='true']", { timeout: 30_000 });
  await page.getByLabel("E-mail").fill(credentials.email);
  await page.getByLabel("Senha", { exact: true }).fill(credentials.password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/dashboard", { timeout: 30_000 });
}
