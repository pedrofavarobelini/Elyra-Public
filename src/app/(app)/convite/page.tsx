import type { Metadata } from "next";

import { parseReturnTo } from "@/lib/navigation/return-to";
import { InviteRedeemView } from "./view";

export const metadata: Metadata = {
  title: "Conectar com um profissional",
  // O fragmento com o token nunca chega ao servidor; ainda assim, esta pagina
  // nao vaza origem para destinos externos.
  referrer: "no-referrer",
};

export default async function ConvitePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // L-398: veio do perfil de um profissional? Volta para ele (so caminho interno validado).
  return <InviteRedeemView back={parseReturnTo((await searchParams).returnTo)} />;
}
