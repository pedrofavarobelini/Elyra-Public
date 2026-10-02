"use client";

import { useSyncExternalStore } from "react";

import { isReducedMotion, subscribeReducedMotion } from "@/lib/motion";

/*
  Movimento reduzido para o que e animado por JavaScript (Recharts, video de
  marca, rotinas) — a regra de CSS nao alcanca. Fonte unica em `@/lib/motion`:
  sistema OU preferencia interna da Elyra (MOTION-GAP-01). No servidor responde
  `true`: e o estado seguro, sem animacao.
*/
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, isReducedMotion, () => true);
}

const noopSubscribe = () => () => undefined;

/*
  Animacao de grafico: somente com dado real, sem movimento reduzido e fora de
  automacao. O QA visual (Playwright, `navigator.webdriver`) precisa de captura
  deterministica — uma linha fotografada no meio do desenho e falso negativo —,
  e series longas animadas custam INP no celular.
*/
export function useChartAnimation(points: number, hasData: boolean): boolean {
  const reduced = usePrefersReducedMotion();
  const automated = useSyncExternalStore(
    noopSubscribe,
    () => navigator.webdriver === true,
    () => true,
  );
  return hasData && !reduced && !automated && points <= 120;
}
