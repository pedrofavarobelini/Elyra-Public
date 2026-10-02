import { notFound, permanentRedirect } from "next/navigation";
import { z } from "zod";

/**
 * Rota legada do dossie. So redireciona UUID bem formado: qualquer outra coisa
 * e 404 aqui mesmo, sem ecoar o valor recebido para uma URL nova.
 */
export default async function LegacyPacienteDossierPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) notFound();
  permanentRedirect(`/pro/acompanhamentos/${parsed.data}`);
}
