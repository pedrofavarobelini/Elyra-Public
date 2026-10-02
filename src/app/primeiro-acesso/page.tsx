import type { Metadata } from "next";

import { safeInternalPath } from "@/lib/security/safe-redirect";
import { requireAuthenticatedUser } from "@/server/auth";

import { FirstAccessForm } from "./first-access-form";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Antes de começar",
  robots: { index: false, follow: false },
};

/**
 * Fora de `(app)` e `(pro)` de proposito.
 *
 * O portao de consentimento vive nos layouts daqueles dois grupos. Se esta
 * pagina morasse dentro de um deles, o portao a bloquearia e mandaria a pessoa
 * para ela mesma — um laco. Ficar fora elimina o laco **por construcao**, em vez
 * de depender de uma lista de excecoes que alguem esquece de atualizar.
 *
 * Exige sessao (`requireAuthenticatedUser`), e nao consentimento: e exatamente
 * quem ainda nao consentiu que precisa chegar aqui.
 */
export default async function PrimeiroAcessoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAuthenticatedUser();
  const { next } = await searchParams;
  return <FirstAccessForm next={safeInternalPath(typeof next === "string" ? next : null)} />;
}
