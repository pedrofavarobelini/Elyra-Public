import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader } from "@/components/journey/page-header";
import { Button } from "@/components/ui/button";
import { accountFactsFrom } from "@/lib/account";
import { requireAuthenticatedUser } from "@/server/auth";
import { getProfessionalCapability } from "@/server/auth-context";
import { ProfileView } from "./view";

export const metadata: Metadata = { title: "Perfil" };

/**
 * Perfil = identidade e conta. Configuracoes = comportamento e preferencias.
 *
 * Os dados extras (membro desde, metodo de acesso, ultimo acesso) vem do usuario
 * autenticado que o servidor ja le para autorizar a pagina — nenhuma consulta
 * nova, nenhum campo inventado. O objetivo na Elyra vem do snapshot de
 * preferencias que o layout ja carrega.
 */
export default async function PerfilPage() {
  const { supabase, user } = await requireAuthenticatedUser();
  const [profile, professionalState] = await Promise.all([
    supabase.from("profiles").select("avatar_path").eq("user_id", user.id).single(),
    getProfessionalCapability(supabase, user.id),
  ]);
  if (profile.error || !profile.data) throw profile.error ?? new Error("profile_missing");

  return (
    <>
      <PageHeader
        title="Perfil"
        description="Sua identidade, seu acesso e um resumo dos seus registros."
        action={
          <Button asChild variant="secondary">
            <Link href="/configuracoes">Configurações</Link>
          </Button>
        }
      />
      <ProfileView
        account={accountFactsFrom(user)}
        initialHasPhoto={Boolean(profile.data.avatar_path)}
        professionalState={professionalState}
      />
    </>
  );
}
