import { describe, expect, it } from "vitest";

import {
  ELYRA_TEXTUAL_CONTRACT_VERSION,
  ELYRA_TEXTUAL_INPUT_VERSION,
  ELYRA_TEXTUAL_OPERATION,
  analyticsReportSchema,
  elyraTextualInputSchema,
  elyraTextualOutputSchema,
} from "@/lib/contracts/pedrocore";
import {
  pedroCoreOutputFixture,
  pedroCoreReportFixture,
} from "@/lib/contracts/pedrocore-fixtures";

describe("contrato PedroCore textual Elyra", () => {
  it("aceita exatamente o snapshot deterministico versionado", () => {
    expect(analyticsReportSchema.parse(pedroCoreReportFixture())).toEqual(
      pedroCoreReportFixture(),
    );
  });

  it("constroi input somente com consentimento explicito", () => {
    const input = {
      contractVersion: ELYRA_TEXTUAL_CONTRACT_VERSION,
      inputSchemaVersion: ELYRA_TEXTUAL_INPUT_VERSION,
      operation: ELYRA_TEXTUAL_OPERATION,
      aiInferenceConsent: true,
      report: pedroCoreReportFixture(),
    };
    expect(elyraTextualInputSchema.parse(input)).toEqual(input);
    expect(
      elyraTextualInputSchema.safeParse({
        ...input,
        aiInferenceConsent: false,
      }).success,
    ).toBe(false);
  });

  it("falha fechado para contexto extra, diario bruto ou schema divergente", () => {
    const report = pedroCoreReportFixture();
    expect(
      analyticsReportSchema.safeParse({ ...report, rawJournal: "nao atravessa" })
        .success,
    ).toBe(false);
    expect(
      analyticsReportSchema.safeParse({
        ...report,
        analyticsVersion: "elyra-analytics/v2",
      }).success,
    ).toBe(false);
  });

  it("recusa serie incompleta, desordenada ou fora da janela", () => {
    const report = pedroCoreReportFixture();
    expect(
      analyticsReportSchema.safeParse({
        ...report,
        series: report.series.slice(1),
      }).success,
    ).toBe(false);
    expect(
      analyticsReportSchema.safeParse({
        ...report,
        series: [report.series[1], report.series[0], ...report.series.slice(2)],
      }).success,
    ).toBe(false);
  });

  it("valida output integral e recusa safety, extras ou versao invalida", () => {
    const output = pedroCoreOutputFixture("stage09-correlation-001");
    expect(elyraTextualOutputSchema.parse(output)).toEqual(output);
    expect(
      elyraTextualOutputSchema.safeParse({ ...output, partial: true }).success,
    ).toBe(false);
    expect(
      elyraTextualOutputSchema.safeParse({
        ...output,
        safety: { ...output.safety, diagnosticClaim: true },
      }).success,
    ).toBe(false);
  });
});
