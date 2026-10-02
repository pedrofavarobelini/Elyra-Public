import type { Metadata } from "next";

import { signupAction } from "@/app/(auth)/actions";
import { AuthForm } from "@/app/(auth)/auth-form";
import { parseAuthContext } from "@/lib/contracts/auth-context";


export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Criar conta" };

/**
 * F1: `?context=professional` cria **a mesma conta Elyra de sempre** (uma
 * identidade Auth) e, depois do aceite, leva ao cadastro profissional — nunca
 * ao portal. So a intencao muda o destino.
 */
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { context } = await searchParams;
  return <AuthForm mode="signup" action={signupAction} entryContext={parseAuthContext(context)} />;
}
