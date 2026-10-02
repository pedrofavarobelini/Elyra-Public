import "server-only";

import { redirect } from "next/navigation";

import { PROFESSIONAL_AREA_PATH, type ProfessionalState } from "@/lib/contracts/professional-state";
import { getConsentedApiUser, requireConsentedUser } from "@/server/auth";
import { readProfessionalState } from "@/server/auth-context";


export async function requireVerifiedProfessional() {
  const auth = await requireConsentedUser();
  const read = await readProfessionalState(auth.supabase, auth.user.id);
  if (!read.ok || read.state !== "VERIFIED") redirect(PROFESSIONAL_AREA_PATH);
  return { ...auth, professionalState: read.state };
}

export const PROFESSIONAL_VERIFICATION_REQUIRED_CODE = "PROFESSIONAL_VERIFICATION_REQUIRED";

/** Portao das APIs exclusivas do portal. `403` com codigo estavel. */
export async function getVerifiedProfessionalApiUser() {
  const consented = await getConsentedApiUser();
  if (consented.denial) return consented;
  const read = await readProfessionalState(consented.auth.supabase, consented.auth.user.id);
  if (!read.ok || read.state !== "VERIFIED") {
    return {
      auth: null,
      denial: Response.json(
        {
          error: "A área profissional abre depois da verificação do registro.",
          code: PROFESSIONAL_VERIFICATION_REQUIRED_CODE,
        },
        { status: 403 },
      ),
    } as const;
  }
  return consented;
}

export type { ProfessionalState };
