"use client";
import { Logo } from "@/components/layout/logo";
/** Static decorative identity; forms are immediately available. */
export function MobilePreLoginSplash() { return null; }
export function DesktopBrandMotion() {
  return <div aria-hidden="true" data-testid="desktop-brand-motion" className="auth-brand-motion"><Logo variant="full" priority /></div>;
}
