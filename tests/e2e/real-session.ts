import { expect, type Page } from "@playwright/test";



const TRANSCRIPT =
  "Hoje conversei sobre a minha rotina de estudos e sobre como o meu sono " +
  "tem influenciado a minha disposicao ao longo da semana.";

export async function createAnalyzedSession(page: Page): Promise<string> {
  const enabled = await page.request.patch("/api/me/preferences", {
    data: { sessionsEnabled: true },
  });
  expect(enabled.ok()).toBe(true);

  const created = await page.request.post("/api/multimodal/sessions", {
    data: {
      kind: "guided",
      screen: false,
      camera: true,
      /*
        Consentimento de analise visual, obrigatorio desde que a captura passou a
        dizer *o que* se moveu e nao so que algo mudou.

        `false` de proposito: a cobertura declarada abaixo tem apenas `screen`,
        `camera` e `microphone`, sem nenhuma modalidade visual. Ligar aqui
        prometeria observacao de corpo que esta fixture nao produz.
      */
      visualAnalysis: false,
      microphone: true,
      transcribe: true,
      keepRecording: false,
      aiAnalysis: true,
      shareResult: false,
      shareTranscript: false,
      shareRecording: false,
      trainingEligible: false,
    },
  });
  expect(created.ok()).toBe(true);
  const { data: session } = (await created.json()) as { data: { id: string } };

  for (const status of ["capturing", "completed"] as const) {
    const moved = await page.request.patch(
      `/api/multimodal/sessions/${session.id}`,
      { data: { status } },
    );
    expect(moved.ok()).toBe(true);
  }

  // Medidas deterministas, no formato que o navegador submeteria. Nao sao
  // "resultado pronto": elas passam pelo mesmo service, pela mesma baseline
  // pessoal e pela mesma RLS que uma captura real.
  const analysed = await page.request.post(
    `/api/multimodal/sessions/${session.id}/analysis`,
    {
      data: {
        durationMs: 300_000,
        capturedResources: ["camera", "microphone"],
        transcript: {
          status: "available",
          text: TRANSCRIPT,
          wordCount: TRANSCRIPT.trim().split(/\s+/u).length,
          voicedDurationMs: 96_000,
          truncated: false,
        },
        measurements: [
          { name: "speech_rate", value: 132 },
          { name: "pause_count", value: 9 },
          { name: "pause_total_duration", value: 21_400 },
          { name: "pause_mean_duration", value: 2378 },
          { name: "vocal_variation", value: 0.42 },
          { name: "movement_frequency", value: 0.27 },
        ],


        // representar, e uma fixture so com cobertura completa nunca o
        // exercitaria no caminho real.
        coverage: [
          {
            modality: "screen",
            outcome: "absent",
            reason: "not_requested",
            coverageMs: 0,
            sessionDurationMs: 300_000,
          },
          {
            modality: "camera",
            outcome: "partial",
            reason: "interrupted",
            coverageMs: 80_000,
            sessionDurationMs: 300_000,
          },
          {
            modality: "microphone",
            outcome: "full",
            reason: null,
            coverageMs: 300_000,
            sessionDurationMs: 300_000,
          },
        ],
      },
    },
  );
  expect(analysed.ok()).toBe(true);

  return session.id;
}

export async function removeSession(page: Page, sessionId: string) {
  await page.request.delete(`/api/multimodal/sessions/${sessionId}`);
  // L-405: `createAnalyzedSession` liga as sessoes na identidade de QA; sem
  // desligar aqui, specs seguintes ("configuracoes sensiveis nascem
  // desligadas") herdavam o estado.
  await page.request.patch("/api/me/preferences", { data: { sessionsEnabled: false } });
}
