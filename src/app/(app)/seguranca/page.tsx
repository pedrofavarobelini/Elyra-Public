import type { Metadata } from "next";

import { PageHeader } from "@/components/journey/page-header";
import { accountFactsFrom } from "@/lib/account";
import { getPasskeysState } from "@/app/passkey-actions";
import { requireAuthenticatedUser } from "@/server/auth";
import { hasVerifiedTotp } from "@/server/auth-mfa";
import { getIdentitySnapshot } from "@/server/services/identity-service";
import { SecurityView } from "./view";

export const metadata: Metadata = { title: "Segurança" };


export default async function SegurancaPage() {
  const { supabase, user, appLock } = await requireAuthenticatedUser();
  // Estado real do fator, lido no servidor: a tela nunca adivinha se ha 2FA ativa.
  const [mfaEnabled, passkeys, identity] = await Promise.all([
    hasVerifiedTotp(supabase),
    getPasskeysState(supabase),
    getIdentitySnapshot(supabase, user),
  ]);

  return (
    <>
      <PageHeader
        title="Segurança"
        description="Como você entra na Elyra e como manter esse acesso só seu."
      />
      <SecurityView
        account={accountFactsFrom(user)}
        mfaEnabled={mfaEnabled}
        passkeysAvailable={passkeys.available}
        passkeys={passkeys.passkeys}
        passkeyOwner={identity.user}
        appLock={appLock}
        appLockUserId={user.id}
      />
    </>
  );
}
