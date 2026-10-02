import type { Metadata } from "next";

import { RecoveryForm } from "./recovery-form";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Recuperar acesso",
  robots: { index: false, follow: false },
};

export default async function RecuperarSenhaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { erro } = await searchParams;
  return <RecoveryForm result={typeof erro === "string" ? erro : null} />;
}
