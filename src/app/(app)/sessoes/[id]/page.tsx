import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SessionResultView } from "./view";
import { requireAuthenticatedUser } from "@/server/auth";
import { getMultimodalSession } from "@/server/services/multimodal-service";
import { getSessionAnalysis } from "@/server/services/session-analysis-service";
import {
  readCurrentCorrection,
  readSessionFeedback,
} from "@/server/services/feedback-service";

export const metadata: Metadata = { title: "Análise da sessão" };

const SESSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;


export default async function SessaoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!SESSION_ID.test(id)) notFound();

  const { supabase, user } = await requireAuthenticatedUser();
  const loaded = await Promise.all([
    getMultimodalSession(supabase, id),
    getSessionAnalysis(supabase, user, id),
  ]).catch(() => null);
  if (!loaded) notFound();

  /*
    Avaliacao e correcao sao carregadas a parte, e uma falha nelas NAO derruba a
    pagina: a analise da sessao e o conteudo, e o feedback e acessorio. Perder o
    resultado inteiro porque a leitura de um polegar falhou trocaria um defeito
    pequeno por um grande.
  */
  const [feedback, correction] = await Promise.all([
    readSessionFeedback(supabase, id).catch(() => []),
    readCurrentCorrection(supabase, id).catch(() => null),
  ]);

  const [session, analysis] = loaded;
  return (
    <SessionResultView
      session={session}
      analysis={analysis}
      feedback={feedback}
      correction={correction}
    />
  );
}
