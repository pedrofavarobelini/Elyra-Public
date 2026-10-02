import { z, ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import { LearningRepositoryError } from "@/server/repositories/learning-repository";
import {
  getTrainingConsent,
  updateTrainingConsent,
} from "@/server/services/learning-service";



const payloadSchema = z.object({
  enabled: z.boolean({ message: "Informe se o consentimento está ativo." }),
});

export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const { supabase, user } = auth;
  try {
    const active = await getTrainingConsent(supabase, user);
    return Response.json({ data: { enabled: active } });
  } catch (error) {
    if (error instanceof LearningRepositoryError) {
      return Response.json(
        { error: "Não foi possível ler o consentimento." },
        { status: 500 },
      );
    }
    throw error;
  }
}

export async function PATCH(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const { supabase, user } = auth;
  try {
    const { enabled } = payloadSchema.parse(await request.json());
    await updateTrainingConsent(supabase, enabled);

    // O estado devolvido e relido da fonte, nunca ecoado do pedido: se a RPC
    // recusar ou o grant ja existir, quem responde e o banco.
    const active = await getTrainingConsent(supabase, user);
    return Response.json({ data: { enabled: active } });
  } catch (error) {
    if (error instanceof ZodError) {
      return Response.json(
        { error: error.issues[0]?.message ?? "Dados inválidos." },
        { status: 400 },
      );
    }
    if (error instanceof LearningRepositoryError) {
      return Response.json(
        { error: "Não foi possível salvar o consentimento." },
        { status: 500 },
      );
    }
    throw error;
  }
}
