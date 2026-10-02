"use client";

import { CycleOnboarding } from "./onboarding";
import { CycleView } from "./cycle-view";

import { useMockStore } from "@/mocks/store";

/**
 * Portao do modulo de ciclo.
 *
 * A figura 2 (opt-in) e a figura 3 (ciclo e bem-estar) sao **estados da mesma
 * rota**, nao duas telas soltas. Modelar o opt-in como uma pagina separada faria
 * parecer que o consentimento e uma etapa de cadastro; aqui ele e o que governa
 * o acesso ao modulo, e continua governando depois de ativado.
 */
export function CycleGate() {
  const { cycle } = useMockStore();
  return cycle.enabled ? <CycleView /> : <CycleOnboarding />;
}
