import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AsrModelComparison } from "@/components/asr-model-comparison";
import { asrAbComparisonAllowed } from "@/lib/qa/asr-ab-mode";



export const metadata: Metadata = {
  title: "Comparar modelos de transcrição",
  robots: { index: false, follow: false },
};

/*
  Sem cache.

  O portao le variavel de ambiente, e uma resposta cacheada de quando o flag
  estava ligado sobreviveria a ele ser desligado.
*/
export const dynamic = "force-dynamic";

export default function AsrAbPage() {
  if (!asrAbComparisonAllowed()) notFound();
  return <AsrModelComparison />;
}
