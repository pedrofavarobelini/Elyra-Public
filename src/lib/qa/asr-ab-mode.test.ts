import { describe, expect, it } from "vitest";

import {
  ASR_AB_FLAG,
  asrAbComparisonAllowed,
  asrAbComparisonFlagEnabled,
} from "@/lib/qa/asr-ab-mode";

describe("portao do modo de comparacao A/B", () => {
  it("J — ambiente vazio desliga", () => {
    expect(asrAbComparisonAllowed({})).toBe(false);
    expect(asrAbComparisonFlagEnabled({})).toBe(false);
  });

  it("J — producao com o flag ligado continua desligado", () => {
    /*
      O cenario que mais importa: alguem copia `.env.local` para producao.
      O flag sozinho nao abre nada.
    */
    expect(
      asrAbComparisonAllowed({ ELYRA_RUNTIME_ENV: "production", [ASR_AB_FLAG]: "1" }),
    ).toBe(false);
  });

  it("J — QA sem o flag continua desligado", () => {
    expect(asrAbComparisonAllowed({ ELYRA_RUNTIME_ENV: "qa" })).toBe(false);
    expect(asrAbComparisonAllowed({ ELYRA_RUNTIME_ENV: "qa", [ASR_AB_FLAG]: "0" })).toBe(false);
  });

  it("J — so as duas condicoes juntas abrem", () => {
    expect(
      asrAbComparisonAllowed({ ELYRA_RUNTIME_ENV: "qa", [ASR_AB_FLAG]: "1" }),
    ).toBe(true);
  });

  it("J — valores parecidos com 'ligado' nao ligam", () => {
    for (const value of ["true", "yes", "on", "sim", " 1", "01"]) {
      expect(
        asrAbComparisonAllowed({ ELYRA_RUNTIME_ENV: "qa", [ASR_AB_FLAG]: value }),
      ).toBe(false);
    }
  });

  it("J — desenvolvimento nao liga por conveniencia", () => {
    /*
      `physical-diagnostic` liga sozinho em `NODE_ENV=development`. Aqui nao:
      isto baixa 251,8 MB de um modelo que nao e o da Elyra.
    */
    expect(
      asrAbComparisonAllowed({ NODE_ENV: "development", [ASR_AB_FLAG]: "1" }),
    ).toBe(false);
  });

  it("o flag e publico, e o nome diz isso", () => {
    // Se algum dia perder o prefixo, o navegador para de ver — e a tela some
    // sem erro. Melhor falhar aqui.
    expect(ASR_AB_FLAG.startsWith("NEXT_PUBLIC_")).toBe(true);
  });
});
