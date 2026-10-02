import type { Metadata } from "next";

import { loginAction } from "@/app/(auth)/actions";
import { AuthForm } from "@/app/(auth)/auth-form";
import { parseAuthContext } from "@/lib/contracts/auth-context";
import { safeInternalPath } from "@/lib/security/safe-redirect";


export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Entrar" };

/**
 * `?oauth=` e lido aqui, no servidor, e repassado como rotulo.
 *
 * A alternativa seria `useSearchParams` dentro do formulario, que obrigaria a
 * envolver a tela inteira em `Suspense` por causa de um parametro opcional. A
 * pagina ja e `force-dynamic`; ler a query aqui nao custa nada.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { oauth, context, next } = await searchParams;
  return (
    <AuthForm
      mode="login"
      action={loginAction}
      oauthResult={typeof oauth === "string" ? oauth : null}

      // valida de novo quando o formulario volta.
      entryContext={parseAuthContext(context)}
      next={safeInternalPath(typeof next === "string" ? next : null, "") || null}
    />
  );
}
