import type { Metadata } from "next";

import { ResetForm } from "./reset-form";


export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Criar uma nova senha",
  robots: { index: false, follow: false },
};

export default function RedefinirSenhaPage() {
  return <ResetForm />;
}
