"use client";

import { RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";


export function ServiceWorkerRegistrar() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  // So recarrega quando a pessoa pediu: na primeira instalacao o worker assume
  // o controle sozinho (`clients.claim`) e recarregar ali interromperia a tela.
  const updateRequested = useRef(false);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("serviceWorker" in navigator)) return;

    let cancelled = false;
    let reloading = false;
    const onControllerChange = () => {
      if (!updateRequested.current || reloading) return;
      reloading = true;
      window.location.reload();
    };

    const watch = (registration: ServiceWorkerRegistration) => {
      if (registration.waiting && navigator.serviceWorker.controller) {
        setWaiting(registration.waiting);
      }
      registration.addEventListener("updatefound", () => {
        const installing = registration.installing;
        installing?.addEventListener("statechange", () => {
          if (installing.state === "installed" && navigator.serviceWorker.controller && !cancelled) {
            setWaiting(installing);
          }
        });
      });
    };

    const register = () => {
      if (cancelled) return;
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          if (!cancelled) watch(registration);
        })
        .catch(() => {
          // Ausencia de worker nao e falha de produto.
        });
    };

    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);
    /*
      Depois do `load`, e nao durante a hidratacao: registrar concorre por rede
      e CPU exatamente no momento em que a primeira tela esta sendo montada.
    */
    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker?.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  if (!waiting) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-elyra-update=""
      className="motion-rise-in fixed inset-x-3 top-[4.5rem] z-40 mx-auto flex max-w-md flex-wrap items-center justify-between gap-2 rounded-card border border-brand-200 bg-surface px-4 py-3 shadow-overlay lg:top-4"
    >
      <p className="text-sm text-ink">
        Nova versão da Elyra disponível. Suas alterações ficam guardadas.
      </p>
      <Button
        size="sm"
        onClick={() => {
          updateRequested.current = true;
          waiting.postMessage({ type: "SKIP_WAITING" });
        }}
      >
        <RefreshCw aria-hidden="true" />
        Atualizar
      </Button>
    </div>
  );
}
