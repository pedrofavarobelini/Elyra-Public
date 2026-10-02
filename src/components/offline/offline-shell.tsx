"use client";

import { CheckCircle2, CloudOff, LockKeyhole, RefreshCw, WifiOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";

import { CycleGate } from "@/app/(app)/ciclo/view";
import { DashboardView } from "@/app/(app)/dashboard/view";
import { JournalView } from "@/app/(app)/diario/view";
import { HistoryView } from "@/app/(app)/historico/view";
import { GoalsView } from "@/app/(app)/metas/view";
import { CheckinView } from "@/app/(app)/meu-humor/view";
import { ReportsView } from "@/app/(app)/relatorios/view";
import { SosButton } from "@/components/help/sos-button";
import { BrandHomeLink } from "@/components/layout/brand-home-link";
import { Logo } from "@/components/layout/logo";
import { NavDrawer } from "@/components/layout/nav-drawer";
import { Sidebar } from "@/components/layout/sidebar";
import {
  ConnectivityContext,
  useConnectivityMonitor,
  useLinkState,
  useOfflineNavigation,
} from "@/components/offline/connectivity";
import { OfflineGatewayContext, OfflineSnapshotContext, useGatewayState } from "@/components/offline/offline-context";
import { SyncIndicator } from "@/components/offline/sync-status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { CycleSnapshot } from "@/lib/contracts/cycle";
import type { PersonalWindowInfo } from "@/lib/contracts/personal-window";
import type { EmotionalSnapshot } from "@/lib/contracts/emotional";
import type { GoalsSnapshot } from "@/lib/contracts/goals";
import type { AppUser, UserPreferences } from "@/lib/contracts/identity";
import type { JournalSnapshot } from "@/lib/contracts/journal";
import { APP_LOCK_STATE, effectiveAppLockState, type LocalAppLockRecord } from "@/lib/app-lock/contracts";
import {
  broadcastAppLock,
  localAppLockSummary,
  unlockLocalAppLock,
} from "@/lib/app-lock/local";
import { LINK_STATE, type ConnectivityMonitor } from "@/lib/offline/connectivity";
import { canOpenOffline, type PersonalSnapshot } from "@/lib/offline/contracts";
import { getOfflineStore } from "@/lib/offline/db";
import { createOfflineGateway, type OfflineGateway } from "@/lib/offline/gateway";
import { offlinePolicyFor, type OfflineRoutePolicy } from "@/lib/offline/route-policy";
import { MockProvider } from "@/mocks/store";
import { SupportNetworkOfflineView } from "@/components/support-network/support-network-offline-view";
import { SupportContentOfflineView } from "@/components/support-content/support-content-offline-view";
import { InlineSpinner } from "@/components/states";



const CORE_VIEWS: Record<string, () => ReactNode> = {
  "/dashboard": () => <DashboardView />,
  "/meu-humor": () => <CheckinView />,
  "/historico": () => <HistoryView />,
  "/diario": () => <JournalView />,
  "/metas": () => <GoalsView />,
  "/ciclo": () => <CycleGate />,
  "/relatorios": () => <ReportsView />,
  // SUP-2: so leitura da ultima lista salva (dado institucional, sem mapa).
  "/rede-de-apoio": () => <SupportNetworkOfflineView />,
};

/** SUP-3: rotas que recebem a rota completa (leitura por slug). */
const ROUTE_VIEWS: Record<string, (route: string) => ReactNode> = {
  "/conteudos-de-apoio": (route) => <SupportContentOfflineView route={route} />,
};

type Ready = {
  status: "ready";
  gateway: OfflineGateway;
  snapshot: PersonalSnapshot;
  route: string;
};
type Locked = {
  status: "locked";
  userId: string;
  record: LocalAppLockRecord | null;
};
type ShellState =
  | { status: "loading" }
  | { status: "fallback" }
  | { status: "professional"; route: string }
  | Locked
  | Ready;

function routeFromLocation() {
  return new URLSearchParams(window.location.search).get("de") ?? "/dashboard";
}

export function OfflineShell({ fallback }: { fallback: ReactNode }) {
  const [state, setState] = useState<ShellState>({ status: "loading" });
  // A pagina so aparece porque uma navegacao falhou: comeca sem conexao e confirma.
  const monitor = useConnectivityMonitor(LINK_STATE.OFFLINE);

  useEffect(() => {
    let cancelled = false;
    const route = routeFromLocation();
    const store = getOfflineStore();
    void (async () => {
      // OFF-4: area profissional sem rede nunca monta o workspace pessoal nem le
      // dado local; tela propria, em contexto profissional.
      if (offlinePolicyFor(route).area === "professional") {
        await Promise.resolve();
        if (!cancelled) setState({ status: "professional", route });
        return;
      }
      try {
        const device = await store.getDevice();
        if (cancelled) return;
        if (!device || !canOpenOffline(device)) {
          setState({ status: "fallback" });
          return;
        }
        const appLock = await store.getAppLock(device.userId);
        const expectedLock = device.appLockId ?? appLock?.lockId ?? null;
        if (
          expectedLock &&
          (!appLock || appLock.lockId !== expectedLock || effectiveAppLockState(appLock) !== APP_LOCK_STATE.UNLOCKED)
        ) {
          setState({ status: "locked", userId: device.userId, record: appLock });
          return;
        }
        const snapshot = await store.getSnapshot(device.userId);
        if (!snapshot) {
          setState({ status: "fallback" });
          return;
        }
        const gateway = createOfflineGateway({
          userId: device.userId,
          store,
          mode: "shell",
          onNetworkFailure: () => monitor.signalDown(),
        });
        void gateway.start();
        setState({ status: "ready", gateway, snapshot, route });
      } catch {
        if (!cancelled) setState({ status: "fallback" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monitor]);

  useEffect(() => {
    if (state.status !== "ready") return;
    return () => state.gateway.dispose();
  }, [state]);

  if (state.status === "professional") return <ProfessionalOffline route={state.route} />;
  if (state.status === "locked") return <OfflineAppLock {...state} />;
  if (state.status !== "ready") return <>{fallback}</>;
  return (
    <ConnectivityContext.Provider value={monitor}>
      <OfflineCore {...state} monitor={monitor} />
    </ConnectivityContext.Provider>
  );
}

function OfflineAppLock({ userId, record }: Locked) {
  const [pin, setPin] = useState("");
  const [current, setCurrent] = useState(record);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(0);
  const seconds = useMemo(() => current?.cooldownUntil
    ? Math.max(0, Math.ceil((Date.parse(current.cooldownUntil) - now) / 1_000))
    : 0, [current?.cooldownUntil, now]);
  const cooling = Boolean(current?.cooldownUntil) && (now === 0 || seconds > 0);

  useEffect(() => {
    if (!current?.cooldownUntil) return;
    const firstTick = window.setTimeout(() => setNow(Date.now()), 0);
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => {
      window.clearTimeout(firstTick);
      window.clearInterval(timer);
    };
  }, [current?.cooldownUntil]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!current) return;
    setPending(true);
    setMessage(null);
    try {
      const result = await unlockLocalAppLock(getOfflineStore(), userId, pin);
      setCurrent(result.record);
      if (result.status === "unlocked") {
        broadcastAppLock(userId, localAppLockSummary(result.record!));
        window.location.reload();
        return;
      }
      setMessage(result.status === "cooldown"
        ? "Muitas tentativas. Aguarde antes de tentar novamente."
        : "PIN incorreto.");
    } catch {
      setMessage("Não foi possível verificar o PIN neste aparelho.");
    } finally {
      setPending(false);
      setPin("");
    }
  }

  return (
    <main className="elyra-canvas flex min-h-dvh items-center justify-center px-4 py-10">
      <section aria-labelledby="offline-lock-title" className="w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
        <Logo className="h-9" />
        <div className="mt-6 inline-flex size-12 items-center justify-center rounded-pill bg-brand-100 text-brand-700" aria-hidden="true">
          <LockKeyhole className="size-6" />
        </div>
        <h1 id="offline-lock-title" className="mt-4 text-2xl font-semibold tracking-tight text-ink">Elyra bloqueada</h1>
        <p className="mt-2 text-sm text-ink-muted">
          A interface e os dados deste aparelho continuam ocultos enquanto você está sem conexão.
        </p>
        {current ? (
          <form className="mt-6 grid gap-4" onSubmit={(event) => void submit(event)}>
            <label htmlFor="offline-lock-pin" className="grid gap-1 text-sm font-medium text-ink">
              PIN da Elyra
              <input
                id="offline-lock-pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                pattern="[0-9]*"
                minLength={6}
                maxLength={8}
                autoFocus
                disabled={pending || cooling}
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 8))}
                className="min-h-12 rounded-control border border-line bg-surface px-3 text-lg tracking-[0.3em] text-ink outline-none focus-visible:ring-2 focus-visible:ring-brand-600 disabled:opacity-60"
              />
            </label>
            {message ? <p role="alert" aria-live="assertive" className="text-sm text-danger">{message}</p> : null}
            {cooling ? <p role="status" aria-live="polite" className="text-sm text-ink-muted">
              {seconds > 0 ? `Tente novamente em ${seconds} s.` : "Aguarde para tentar novamente."}
            </p> : null}
            <Button type="submit" disabled={pending || cooling || pin.length < 6}>
              {pending ? "Verificando…" : "Desbloquear offline"}
            </Button>
          </form>
        ) : (
          <p role="alert" className="mt-6 rounded-control bg-attention-soft px-3 py-2 text-sm text-ink">
            O verificador local não está disponível. Reconecte e autentique a conta para recuperar o acesso.
          </p>
        )}
        <p className="mt-4 text-xs text-ink-subtle">
          Sair da conta exige conexão para revogar a sessão. O PIN offline não cria nem renova login.
        </p>
      </section>
    </main>
  );
}

function OfflineCore({ gateway, snapshot, route: initialRoute, monitor }: Ready & { monitor: ConnectivityMonitor }) {
  const [route, setRoute] = useState(initialRoute);

  // Conexao confirmada: sincroniza a fila sem sair da tela.
  useEffect(
    () =>
      monitor.subscribe(() => {
        if (monitor.getState() === LINK_STATE.ONLINE) void gateway.drain();
      }),
    [monitor, gateway],
  );

  const navigateInShell = useCallback((url: URL) => {
    const next = url.pathname === "/offline" ? (url.searchParams.get("de") ?? "/dashboard") : url.pathname;
    setRoute(next);
    window.history.pushState(null, "", `/offline?de=${encodeURIComponent(next)}`);
    window.scrollTo({ top: 0 });
    return true;
  }, []);
  useOfflineNavigation(monitor, navigateInShell);
  useEffect(() => {
    const onPop = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const data = snapshot.data as {
    user: AppUser;
    preferences: UserPreferences;
    checkins: EmotionalSnapshot["checkins"];
    sleep: EmotionalSnapshot["sleep"];
    factors: EmotionalSnapshot["factors"];
    journal: JournalSnapshot["entries"];
    tags: JournalSnapshot["tags"];
    goals: GoalsSnapshot["goals"];
    goalProgress: GoalsSnapshot["progress"];
    cycle: CycleSnapshot["profile"];
    periods: CycleSnapshot["periods"];
    cycleRecords: CycleSnapshot["records"];
    symptoms: CycleSnapshot["symptoms"];
    window?: PersonalWindowInfo;
  };
  const link = useLinkState();
  const gatewayState = useGatewayState(gateway);
  const pending = gatewayState.operations.length;
  // OFF-1: a matriz canonica (`route-policy`) decide o que monta sem rede.
  const policy = offlinePolicyFor(route);
  const mounted = policy.shell !== "online_only";
  const coreRoute = mounted ? Object.keys(CORE_VIEWS).find((path) => path === policy.prefix) : undefined;
  const routeView = mounted ? Object.keys(ROUTE_VIEWS).find((path) => path === policy.prefix) : undefined;
  const snapshotInfo = useMemo(() => ({ savedAt: snapshot.savedAt }), [snapshot.savedAt]);
  const savedAt = new Date(snapshot.savedAt).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <OfflineGatewayContext.Provider value={gateway}>
      <OfflineSnapshotContext.Provider value={snapshotInfo}>
      <MockProvider
        initialUser={data.user}
        initialPreferences={data.preferences}
        initialEmotional={{ checkins: data.checkins, sleep: data.sleep, factors: data.factors }}
        initialJournal={{ entries: data.journal, tags: data.tags }}
        initialGoals={{ goals: data.goals, progress: data.goalProgress }}
        initialCycle={{
          profile: data.cycle,
          periods: data.periods,
          records: data.cycleRecords,
          symptoms: data.symptoms,
        }}
        gateway={gateway}
        initialWindow={data.window}
      >
        <div className="elyra-canvas min-h-dvh lg:grid lg:grid-cols-[var(--spacing-sidebar)_minmax(0,1fr)]">
          <Sidebar context="user" />
          <div className="flex min-w-0 flex-col">
            <header className="sticky top-0 z-40 border-b border-line bg-surface/90 backdrop-blur-md lg:static lg:border-transparent lg:bg-transparent lg:backdrop-blur-none">
              <div className="mx-auto flex h-16 max-w-[100rem] items-center gap-1 px-2 sm:px-4 lg:px-8 2xl:px-10">
                <NavDrawer context="user" userInitials={data.user.initials} />
                <BrandHomeLink variant="symbol" className="lg:hidden" />
                <div className="flex-1" />
                <SyncIndicator />
              </div>
            </header>

            <main
              id="conteudo"
              className="mx-auto w-full max-w-[100rem] flex-1 px-4 pb-24 pt-5 sm:px-6 lg:px-8 lg:pb-24 lg:pt-1 2xl:px-10"
            >
              <p
                role="status"
                data-testid="offline-freshness"
                className="mb-4 flex flex-wrap items-center gap-2 rounded-control bg-surface-muted px-3 py-2 text-sm text-ink-muted"
              >
                {link === LINK_STATE.ONLINE ? (
                  pending > 0 || gatewayState.syncing ? (
                    <>
                      <InlineSpinner className="shrink-0 text-brand-700" />
                      Conexão de volta. Sincronizando…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="size-4 shrink-0 text-positive" aria-hidden="true" />
                      Conexão de volta. Tudo sincronizado.
                    </>
                  )
                ) : link === LINK_STATE.RECONNECTING ? (
                  <>
                    <InlineSpinner className="shrink-0" />
                    Reconectando…
                  </>
                ) : (
                  <>
                    <CloudOff className="size-4 shrink-0" aria-hidden="true" />
                    Sem conexão. Dados deste aparelho de {savedAt}; o que você registrar agora fica
                    guardado aqui até sincronizar.
                  </>
                )}
              </p>
              {coreRoute ? (
                CORE_VIEWS[coreRoute]!()
              ) : routeView ? (
                ROUTE_VIEWS[routeView]!(route)
              ) : (
                <OnlineOnly route={route} policy={policy} />
              )}
            </main>
          </div>
          <SosButton />
        </div>
      </MockProvider>
      </OfflineSnapshotContext.Provider>
    </OfflineGatewayContext.Provider>
  );
}

/**
 * Estado unico de "precisa de conexao" (OFF-1): icone, titulo, a razao da rota
 * (matriz canonica) e "Tentar novamente". Nunca uma pagina que parece funcionar.
 */
export function OnlineOnly({ route, policy }: { route: string; policy: OfflineRoutePolicy }) {
  const [still, setStill] = useState(false);
  const areas: { href: Route; label: string }[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/diario", label: "Diário" },
    { href: "/meu-humor", label: "Meu Humor" },
    { href: "/metas", label: "Metas" },
    { href: "/ciclo", label: "Ciclo" },
    { href: "/relatorios", label: "Relatórios" },
    { href: "/rede-de-apoio", label: "Rede de Apoio — serviços (lista salva)" },
    { href: "/conteudos-de-apoio", label: "Rede de Apoio — artigos" },
  ];
  const requested = route && route !== "/offline";
  const retry = () => {
    // Sem rede o worker devolve o shell de novo; com rede, a pagina real abre.
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setStill(true);
      return;
    }
    window.location.assign(route || "/dashboard");
  };
  return (
    <Card className="mx-auto max-w-xl" data-testid="online-only" data-offline-class={policy.write} data-area={policy.area}>
      <CardHeader>
        <span
          aria-hidden="true"
          className="mb-2 inline-flex size-11 items-center justify-center rounded-pill bg-attention-soft text-attention"
        >
          <WifiOff className="size-5" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Esta área precisa de conexão</h1>
        <CardDescription data-testid="online-only-reason">
          {requested ? policy.explanation : "Escolha uma área que funciona sem internet."}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {requested ? (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="secondary" className="self-start" onClick={retry}>
              <RefreshCw aria-hidden="true" />
              Tentar novamente
            </Button>
            <p aria-live="polite" className="text-sm text-ink-muted empty:hidden">
              {still ? "Ainda sem conexão. Tente de novo quando a rede voltar." : ""}
            </p>
          </div>
        ) : null}
        <div>
          <CardTitle className="mb-2 text-base">Funciona sem conexão</CardTitle>
          <ul className="grid gap-2 sm:grid-cols-2">
            {areas.map((area) => (
              <li key={area.href}>
                <Link
                  href={area.href}
                  className="flex min-h-11 items-center rounded-control border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-surface-brand"
                >
                  {area.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Area profissional sem rede (OFF-4). Continua visualmente profissional, nao
 * monta nenhuma tela nem dado pessoal e nada de acompanhamento fica no aparelho.
 * O SOS continua disponivel (funciona sem internet).
 */
function ProfessionalOffline({ route }: { route: string }) {
  const policy = offlinePolicyFor(route);
  const [still, setStill] = useState(false);
  const retry = () => {
    if (navigator.onLine === false) {
      setStill(true);
      return;
    }
    window.location.assign(route);
  };
  return (
    <main
      id="conteudo"
      data-testid="professional-offline"
      data-context="professional"
      className="elyra-canvas flex min-h-dvh items-center justify-center px-4 py-10"
    >
      <section className="w-full max-w-md rounded-panel border border-line bg-surface p-6 shadow-raised sm:p-8">
        <div className="flex items-center gap-3">
          <Logo className="h-8" />
          <span className="rounded-pill bg-surface-brand px-2.5 py-1 text-xs font-medium text-brand-800">Área profissional</span>
        </div>
        <span
          aria-hidden="true"
          className="mt-6 inline-flex size-11 items-center justify-center rounded-pill bg-attention-soft text-attention"
        >
          <WifiOff className="size-5" />
        </span>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-ink">Esta área precisa de conexão</h1>
        <p className="mt-2 text-sm text-ink-muted" data-testid="online-only-reason">
          {policy.explanation}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button type="button" variant="secondary" className="self-start" onClick={retry}>
            <RefreshCw aria-hidden="true" />
            Tentar novamente
          </Button>
          <p aria-live="polite" className="text-sm text-ink-muted empty:hidden">
            {still ? "Ainda sem conexão. Tente de novo quando a rede voltar." : ""}
          </p>
          <Link href="/dashboard" className="text-sm font-medium text-brand-700 hover:underline">
            Ir para a sua área pessoal (funciona sem internet)
          </Link>
        </div>
      </section>
      <SosButton />
    </main>
  );
}
