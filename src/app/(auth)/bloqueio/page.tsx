import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AppLockScreen } from "./screen";
import { APP_LOCK_STATE } from "@/lib/app-lock/contracts";
import { redirectToInternalPath } from "@/lib/security/internal-redirect";
import { safeInternalPath } from "@/lib/security/safe-redirect";
import { requireAuthenticatedUser } from "@/server/auth";

export const metadata: Metadata = {
  title: "Elyra bloqueada",
  robots: { index: false, follow: false },
};

export default async function AppLockPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { user, appLock } = await requireAuthenticatedUser({ allowLocked: true });
  const next = safeInternalPath((await searchParams).next, "/dashboard");
  if (appLock.state === APP_LOCK_STATE.DISABLED || appLock.state === APP_LOCK_STATE.UNLOCKED) {
    redirectToInternalPath(next);
  }
  if (!appLock.lockId) redirect("/entrar");
  return (
    <AppLockScreen
      userId={user.id}
      lockId={appLock.lockId}
      next={next}
      initial={appLock}
    />
  );
}
