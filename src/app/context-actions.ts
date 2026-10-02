"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";

import { parseAuthContext, professionalHome } from "@/lib/contracts/auth-context";
import { requireAuthenticatedUser } from "@/server/auth";
import { getProfessionalCapability, rememberContext } from "@/server/auth-context";


export async function switchContextAction(formData: FormData) {
  const { user, supabase } = await requireAuthenticatedUser();
  const target = parseAuthContext(formData.get("context"));
  if (!target) redirect("/dashboard");

  await rememberContext(user.id, target);
  if (target === "professional") {
    const capability = await getProfessionalCapability(supabase, user.id);
    redirect(professionalHome(capability) as Route);
  }
  redirect("/dashboard");
}
