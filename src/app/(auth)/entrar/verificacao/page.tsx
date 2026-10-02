import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { MfaVerificationForm } from "@/app/(auth)/entrar/verificacao/form";
import { AuthFrame } from "@/components/layout/auth-frame";
import { getAuthenticatedUser } from "@/server/auth";
import { redirectToInternalPath } from "@/lib/security/internal-redirect";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { mfaStatus } from "@/server/auth-mfa";


export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Verificação em duas etapas" };


export default async function MfaVerificationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {

  // segundo fator. Validado aqui e de novo no cliente: so caminho interno.
  const { next: rawNext } = await searchParams;
  const next = safeInternalPath(typeof rawNext === "string" ? rawNext : null);
  const auth = await getAuthenticatedUser();
  if (!auth) redirect("/entrar");
  if ((await mfaStatus(auth.supabase)) !== "pending") redirectToInternalPath(next);

  return (
    <AuthFrame>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Verificação em duas etapas
        </h1>
        <p className="text-sm text-ink-muted">
          Sua conta pede um código do aplicativo autenticador para completar a entrada.
        </p>
      </div>
      <div className="mt-6">
        <MfaVerificationForm next={next} />
      </div>
    </AuthFrame>
  );
}
