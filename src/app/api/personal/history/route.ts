import { ZodError } from "zod";

import { getConsentedApiUser } from "@/server/auth";
import {
  PersonalHistoryError,
  getPersonalHistory,
} from "@/server/services/personal-window-service";


export async function GET(request: Request) {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  const params = new URL(request.url).searchParams;
  const limit = params.get("limit");
  try {
    const data = await getPersonalHistory(auth.supabase, auth.user, {
      domain: params.get("domain"),
      before: params.get("before"),
      ...(limit ? { limit: Number(limit) } : {}),
    });
    return Response.json({ data });
  } catch (error) {
    if (error instanceof ZodError || error instanceof PersonalHistoryError) {
      return Response.json(
        {
          error:
            error instanceof ZodError
              ? (error.issues[0]?.message ?? "Pedido de histórico inválido.")
              : error.message,
        },
        { status: 400 },
      );
    }
    return Response.json(
      { error: "Não foi possível carregar o histórico." },
      { status: 500 },
    );
  }
}
