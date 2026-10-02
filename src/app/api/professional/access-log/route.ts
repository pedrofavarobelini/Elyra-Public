import { getConsentedApiUser } from "@/server/auth";
import { getMyProfessionalAccessLog } from "@/server/services/professional-service";
import { professionalErrorResponse } from "../response";

/**
 * A trilha de acesso, para quem e dona do dado.
 *
 * Nao aceita parametro de usuario. A RLS ja devolve somente as linhas do
 * titular, e receber um id seria oferecer um lugar para alguem passar o id de
 * outra pessoa - o formato exato do defeito de `L-058`.
 */
export async function GET() {
  const { auth, denial } = await getConsentedApiUser();
  if (denial) return denial;
  try {
    return Response.json({ data: await getMyProfessionalAccessLog(auth.supabase) });
  } catch (error) {
    return professionalErrorResponse(error);
  }
}
